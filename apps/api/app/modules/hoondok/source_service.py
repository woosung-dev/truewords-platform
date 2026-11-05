"""등록된 원문을 문단으로 탐색하고 내부 주소를 서버에서 자동 연결한다."""
import hashlib
import json
import re
import uuid
from fastapi import HTTPException
from app.core.common.clock import utcnow
from app.modules.datasource.chunk_merge import normalize_for_merge, overlap_length
from app.modules.hoondok.source_models import SourceSnapshot, SourceRange
from app.modules.hoondok.source_schemas import (
    SourceBook, SourceSnapshotInfo, SourcePassages, SourceRangeResult,
)
from app.modules.hoondok.summary_schemas import SummarySource
from app.modules.qdrant.filters import build_filter, field_match


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def merge_source_chunks(chunks):
    """기존 읽기와 같은 겹침 제거에 모든 청크의 대응 위치를 더한다."""
    merged = ''
    spans = []
    for chunk in chunks:
        text = normalize_for_merge(chunk['text'])
        overlap = overlap_length(merged, text) if merged else 0
        appended = text[overlap:]
        sep = '' if not merged or merged.endswith(('\n', ' ')) or appended.startswith(('\n', ' ')) else ' '
        start = max(0, len(merged) - overlap)
        merged += sep + appended
        spans.append(dict(chunk, start=start, end=len(merged)))
    return merged, spans


def source_blocks(text, snapshot_id, spans):
    """빈 줄을 우선 사용하며 매우 긴 단락만 읽기 좋은 본문 구간으로 나눈다."""
    blocks = []
    cursor = 0
    for part in re.split(r'\n\s*\n', text):
        found = text.find(part, cursor)
        cursor = found + len(part)
        left, right = found, cursor
        while left < right and text[left].isspace(): left += 1
        while right > left and text[right - 1].isspace(): right -= 1
        while left < right:
            end = min(right, left + 1400)
            if end < right:
                cut = max(text.rfind('\n', left + 650, end), text.rfind('. ', left + 650, end), text.rfind('。', left + 650, end))
                if cut > left: end = cut + 1
            if text[left:end].strip():
                blocks.append({'id': str(uuid.uuid5(snapshot_id, f'{left}:{end}')), 'position': len(blocks), 'label': f'본문 {len(blocks) + 1}', 'text': text[left:end], 'start': left, 'end': end, 'section_id': None})
            left = end
            while left < right and text[left].isspace(): left += 1
    return blocks


class SourceService:
    def __init__(self, repo, client, collection):
        self.repo, self.client, self.collection = repo, client, collection

    async def right(self, right_id):
        right = await self.repo.right(right_id)
        if not right or right.status != 'allowed' or not right.scope_full_text:
            raise HTTPException(404, '원문을 찾을 수 없습니다')
        return right

    async def books(self):
        return [SourceBook(id=r.id, title=r.work_title, volume=r.volume) for r in await self.repo.books()]

    async def snapshot(self, snapshot_id):
        snapshot = await self.repo.snapshot(snapshot_id)
        if not snapshot: raise HTTPException(404, '원문을 찾을 수 없습니다')
        await self.right(snapshot.content_right_id)
        return snapshot

    async def make_snapshot(self, right_id):
        right = await self.right(right_id)
        job = await self.repo.job(right.volume)
        if job and job.status != 'completed':
            raise HTTPException(409, '원문을 준비하고 있습니다. 등록이 끝난 뒤 다시 선택해 주세요')
        points, cursor, seen = [], None, set()
        try:
            while True:
                rows, following = await self.client.scroll(self.collection, scroll_filter=build_filter(must=[field_match('volume', right.volume)]), limit=500, offset=cursor, with_vectors=False)
                points.extend(rows)
                if len(points) > 20000: raise HTTPException(422, '원문이 너무 큽니다. 원문 관리에서 권을 나누어 주세요')
                if following is None: break
                key = str(following)
                if key in seen: raise HTTPException(503, '원문을 끝까지 읽을 수 없습니다. 다시 시도해 주세요')
                seen.add(key); cursor = following
        except HTTPException: raise
        except Exception:
            raise HTTPException(503, '원문을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요') from None
        chunks = []
        for point in points:
            payload = point.payload or {}
            index, text = payload.get('chunk_index'), payload.get('text')
            if payload.get('volume') != right.volume or type(index) is not int or index < 0 or not isinstance(text, str) or not text.strip():
                raise HTTPException(409, '원문 일부가 올바르지 않아 연결할 수 없습니다')
            chunks.append({'id': str(point.id), 'index': index, 'text': normalize_for_merge(text)})
        chunks.sort(key=lambda c: c['index'])
        if not chunks: raise HTTPException(404, '등록된 원문이 없습니다')
        if [c['index'] for c in chunks] != list(range(len(chunks))) or len({c['id'] for c in chunks}) != len(chunks):
            raise HTTPException(409, '원문 중간이 비어 있습니다. 원문 등록 상태를 확인해 주세요')
        if sum(len(c['text']) for c in chunks) > 20_000_000:
            raise HTTPException(422, '원문이 너무 큽니다. 원문 관리에서 권을 나누어 주세요')
        fingerprint = digest(json.dumps([self.collection, right.volume, chunks], ensure_ascii=False, sort_keys=True))
        existing = await self.repo.snapshot_by_hash(right_id, fingerprint)
        if existing: return self.snapshot_info(existing, right)
        snapshot_id = uuid.uuid5(right_id, fingerprint)
        merged, spans = merge_source_chunks(chunks)
        blocks = source_blocks(merged, snapshot_id, spans)
        if not blocks: raise HTTPException(409, '원문에서 선택할 내용을 찾지 못했습니다')
        sections = []
        for heading in await self.repo.sections(right.volume):
            indices = [c for c in spans if c['index'] >= heading.start_chunk_index and c['index'] <= heading.end_chunk_index]
            if not indices: continue
            first, last = indices[0], indices[-1]
            matched = [b for b in blocks if b['end'] > first['start'] and b['start'] < last['end']]
            if not matched: continue
            sections.append({'id': str(uuid.uuid5(snapshot_id, f'section:{heading.position}:{heading.title}')), 'title': heading.title, 'level': heading.level, 'start_block_id': matched[0]['id'], 'end_block_id': matched[-1]['id'], '_start': matched[0]['position'], '_end': matched[-1]['position']})
        if not sections:
            sections = [{'id': str(uuid.uuid5(snapshot_id, 'whole')), 'title': '본문 전체', 'level': 1, 'start_block_id': blocks[0]['id'], 'end_block_id': blocks[-1]['id'], '_start': 0, '_end': len(blocks) - 1}]
        for block in blocks:
            matching = [s for s in sections if s['_start'] <= block['position'] <= s['_end']]
            if matching: block['section_id'] = max(matching, key=lambda s: s['level'])['id']
            if '천성경' in right.work_title:
                number = re.match(r'^(\d{1,3})\s+', block['text'])
                if number: block['label'] = '말씀 ' + number.group(1)
        snapshot = SourceSnapshot(id=snapshot_id, content_right_id=right_id, collection=self.collection, fingerprint=fingerprint, edition=f'{right.work_title} · 현재 등록 원문', text=merged, chunks=spans, blocks=blocks, sections=sections)
        snapshot = await self.repo.save_snapshot(snapshot)
        return self.snapshot_info(snapshot, right)

    def snapshot_info(self, snapshot, right):
        return SourceSnapshotInfo(id=snapshot.id, content_right_id=right.id, title=right.work_title, edition=snapshot.edition, fingerprint=snapshot.fingerprint, sections=snapshot.sections, block_count=len(snapshot.blocks))

    async def passages(self, snapshot_id, offset=0, limit=40, start_block_id=None):
        snapshot = await self.snapshot(snapshot_id)
        if start_block_id:
            positions = [b['position'] for b in snapshot.blocks if b['id'] == start_block_id]
            if not positions: raise HTTPException(422, '선택한 원문 위치를 찾을 수 없습니다')
            offset = positions[0]
        rows = snapshot.blocks[offset:offset + limit]
        return SourcePassages(snapshot_id=snapshot.id, blocks=rows, total=len(snapshot.blocks), next_offset=offset + limit if offset + limit < len(snapshot.blocks) else None)

    def block_range(self, snapshot, start_id, end_id):
        positions = {b['id']: b['position'] for b in snapshot.blocks}
        if start_id not in positions or end_id not in positions or positions[start_id] > positions[end_id]:
            raise HTTPException(422, '시작과 끝 문단을 다시 선택해 주세요')
        return snapshot.blocks[positions[start_id]:positions[end_id] + 1]

    def selected_span(self, blocks, start_offset=0, end_offset=None):
        # Python 문자열 인덱스는 Unicode codepoint 기준이며 끝은 배타적이다.
        end = len(blocks[-1]['text']) if end_offset is None else end_offset
        if (type(start_offset) is not int or type(end) is not int
                or start_offset < 0 or start_offset >= len(blocks[0]['text'])
                or end <= 0 or end > len(blocks[-1]['text'])):
            raise HTTPException(422, '선택한 글자 범위를 다시 확인해 주세요')
        first = blocks[0]['start'] + start_offset
        last = blocks[-1]['start'] + end
        if last <= first:
            raise HTTPException(422, '시작보다 뒤의 글자까지 선택해 주세요')
        return first, last

    async def check_current(self, snapshot, blocks, start_offset=0, end_offset=None):
        if snapshot.collection != self.collection:
            raise HTTPException(409, '원문이 갱신되었습니다. 원문 범위를 다시 선택해 주세요')
        first, last = self.selected_span(blocks, start_offset, end_offset)
        chunks = [c for c in snapshot.chunks if c['end'] > first and c['start'] < last]
        try:
            ids = [int(c['id']) if c['id'].isdecimal() else c['id'] for c in chunks]
            current = await self.client.retrieve(self.collection, ids=ids)
        except Exception:
            raise HTTPException(503, '원문 연결을 확인하지 못했습니다. 다시 시도해 주세요') from None
        by_id = {str(p.id): p.payload or {} for p in current}
        right = await self.right(snapshot.content_right_id)
        if len(by_id) != len(chunks) or any(by_id.get(c['id'], {}).get('volume') != right.volume or by_id[c['id']].get('chunk_index') != c['index'] or not isinstance(by_id[c['id']].get('text'), str) or normalize_for_merge(by_id[c['id']].get('text', '')) != c['text'] for c in chunks):
            raise HTTPException(409, '원문이 변경되었습니다. 범위를 다시 선택해 주세요')
        return chunks

    async def source_for(self, snapshot, blocks, title, group_title, start_offset=0, end_offset=None):
        first, last = self.selected_span(blocks, start_offset, end_offset)
        text = snapshot.text[first:last]
        if not text.strip():
            raise HTTPException(422, '내용이 있는 원문을 선택해 주세요')
        chunks = await self.check_current(snapshot, blocks, start_offset, end_offset)
        if len(text) > 100000 or len(chunks) > 300:
            raise HTTPException(422, '선택한 범위가 너무 깁니다. 구간을 나누어 주세요')
        return SummarySource(edition=snapshot.edition, locator=f'{group_title} · {title}'.strip(' ·')[:500], text=text, chunk_ids=[c['id'] for c in chunks], verified=False, note='관리자가 선택한 등록 원문 범위를 서버에서 자동 연결했습니다.').model_dump(mode='json')

    async def result(self, row):
        snapshot = await self.snapshot(row.snapshot_id)
        blocks = self.block_range(snapshot, row.start_block_id, row.end_block_id)
        first, last = self.selected_span(blocks, row.start_offset, row.end_offset)
        return SourceRangeResult(id=row.id, version=row.version, content_right_id=row.content_right_id, snapshot_id=row.snapshot_id, title=row.title, group_title=row.group_title, start_block_id=row.start_block_id, end_block_id=row.end_block_id, start_offset=row.start_offset, end_offset=row.end_offset, first=snapshot.text[first:min(last, blocks[0]['end'])], last=snapshot.text[max(first, blocks[-1]['start']):last], text=row.source['text'], source=row.source)

    async def get_range(self, range_id, lock=False):
        row = await self.repo.range(range_id, lock)
        if not row: raise HTTPException(404, '편집 구간을 찾을 수 없습니다')
        await self.right(row.content_right_id)
        return row

    async def list_ranges(self, right_id=None):
        rows = await self.repo.ranges(right_id)
        output = []
        for row in rows:
            right = await self.repo.right(row.content_right_id)
            if right and right.status == 'allowed' and right.scope_full_text: output.append(await self.result(row))
        return output

    async def audit(self, row, audit, actor, action):
        await audit.log_audit(admin_user_id=actor, action='source_range.' + action, target_table='hoondok_source_ranges', target_id=row.id, changes={'version': row.version})

    async def create_range(self, data, audit, actor):
        snapshot = await self.snapshot(data.snapshot_id)
        blocks = self.block_range(snapshot, data.start_block_id, data.end_block_id)
        source = await self.source_for(snapshot, blocks, data.title, data.group_title, data.start_offset, data.end_offset)
        row = SourceRange(content_right_id=snapshot.content_right_id, snapshot_id=snapshot.id, title=data.title, group_title=data.group_title, start_block_id=data.start_block_id, end_block_id=data.end_block_id, start_offset=data.start_offset, end_offset=data.end_offset, source=source)
        await self.repo.save(row); await self.audit(row, audit, actor, 'create')
        return await self.result(row)

    def version(self, row, version):
        if row.version != version or row.archived: raise HTTPException(409, '구간이 수정되었습니다. 다시 불러와 주세요')

    async def update_range(self, range_id, data, audit, actor):
        row = await self.get_range(range_id, True); self.version(row, data.version)
        snapshot = await self.snapshot(data.snapshot_id)
        if snapshot.content_right_id != row.content_right_id: raise HTTPException(422, '다른 책으로 구간을 옮길 수 없습니다')
        blocks = self.block_range(snapshot, data.start_block_id, data.end_block_id)
        source = await self.source_for(snapshot, blocks, data.title, data.group_title, data.start_offset, data.end_offset)
        for key in ('snapshot_id', 'title', 'group_title', 'start_block_id', 'end_block_id', 'start_offset', 'end_offset'): setattr(row, key, getattr(data, key))
        row.source = source; row.version += 1; row.updated_at = utcnow()
        await self.repo.save(row); await self.audit(row, audit, actor, 'update')
        return await self.result(row)

    async def split(self, range_id, data, audit, actor):
        row = await self.get_range(range_id, True)
        self.version(row, data.version)
        snapshot = await self.snapshot(row.snapshot_id)
        blocks = self.block_range(snapshot, row.start_block_id, row.end_block_id)
        positions = [i for i, block in enumerate(blocks) if block['id'] == data.after_block_id]
        if not positions:
            raise HTTPException(422, '구간 안쪽의 나눌 위치를 선택해 주세요')
        at = positions[0]
        offset = len(blocks[at]['text']) if data.after_offset is None else data.after_offset
        if offset < 0 or offset > len(blocks[at]['text']):
            raise HTTPException(422, '나눌 글자 위치를 다시 확인해 주세요')
        first, last = self.selected_span(blocks, row.start_offset, row.end_offset)
        cut = blocks[at]['start'] + offset
        if not first < cut < last:
            raise HTTPException(422, '구간 안쪽의 나눌 위치를 선택해 주세요')
        await self.source_for(snapshot, blocks, row.title, row.group_title, row.start_offset, row.end_offset)
        created = []
        for title, begin, end in [(data.first_title, first, cut), (data.second_title, cut, last)]:
            selected = [block for block in blocks if block['end'] > begin and block['start'] < end]
            if not selected:
                raise HTTPException(422, '내용이 있는 두 구간으로 나누어 주세요')
            start_offset = max(0, begin - selected[0]['start'])
            end_offset = min(len(selected[-1]['text']), end - selected[-1]['start'])
            source = await self.source_for(snapshot, selected, title, row.group_title, start_offset, end_offset)
            new = SourceRange(content_right_id=row.content_right_id, snapshot_id=row.snapshot_id, title=title, group_title=row.group_title, start_block_id=selected[0]['id'], end_block_id=selected[-1]['id'], start_offset=start_offset, end_offset=end_offset, source=source)
            created.append(new)
        # 두 결과를 모두 검증한 뒤 한 감사 트랜잭션으로 저장한다.
        for new in created:
            await self.repo.save(new)
        row.archived = True
        row.version += 1
        await self.repo.save(row)
        await self.audit(row, audit, actor, 'split')
        return [await self.result(r) for r in created]

    async def merge(self, range_id, data, audit, actor):
        # UUID 순서로 잠가 반대 방향의 동시 합치기에서 교착을 피한다.
        ordered = sorted([range_id, data.other_id], key=str)
        first = await self.get_range(ordered[0], True)
        second = await self.get_range(ordered[1], True)
        row, other = (first, second) if first.id == range_id else (second, first)
        self.version(row, data.version)
        self.version(other, data.other_version)
        if row.id == other.id or row.snapshot_id != other.snapshot_id:
            raise HTTPException(422, '같은 원문의 이웃한 구간을 선택해 주세요')
        snapshot = await self.snapshot(row.snapshot_id)
        ranges = []
        for candidate in (row, other):
            blocks = self.block_range(snapshot, candidate.start_block_id, candidate.end_block_id)
            begin, end = self.selected_span(blocks, candidate.start_offset, candidate.end_offset)
            ranges.append((begin, end, candidate, blocks))
        a, b = sorted(ranges, key=lambda part: part[0])
        same_boundary = a[1] == b[0]
        adjacent_blocks = (a[3][-1]['position'] + 1 == b[3][0]['position']
                           and a[1] == a[3][-1]['end'] and b[0] == b[3][0]['start'])
        if not (same_boundary or adjacent_blocks):
            raise HTTPException(422, '맞닿은 구간만 합칠 수 있습니다')
        blocks = self.block_range(snapshot, a[2].start_block_id, b[2].end_block_id)
        start_offset, end_offset = a[2].start_offset, b[2].end_offset
        source = await self.source_for(snapshot, blocks, data.title, row.group_title, start_offset, end_offset)
        new = SourceRange(content_right_id=row.content_right_id, snapshot_id=row.snapshot_id, title=data.title, group_title=row.group_title, start_block_id=blocks[0]['id'], end_block_id=blocks[-1]['id'], start_offset=start_offset, end_offset=end_offset, source=source)
        await self.repo.save(new)
        row.archived = other.archived = True
        row.version += 1
        other.version += 1
        await self.repo.save(row)
        await self.repo.save(other)
        await self.audit(new, audit, actor, 'merge')
        return await self.result(new)

    async def resolve(self, range_id, version, right_id):
        row = await self.get_range(range_id)
        if row.content_right_id != right_id: raise HTTPException(422, '선택한 책의 원문 범위가 아닙니다')
        if version is None or row.version != version: raise HTTPException(409, '편집 구간이 바뀌었습니다. 범위를 다시 선택해 주세요')
        snapshot = await self.snapshot(row.snapshot_id)
        blocks = self.block_range(snapshot, row.start_block_id, row.end_block_id)
        return SummarySource.model_validate(await self.source_for(snapshot, blocks, row.title, row.group_title, row.start_offset, row.end_offset))
