"""요약 편집·공개 정책. 작업본과 불변 공개본을 분리한다."""

import json
import uuid
from functools import lru_cache
from pathlib import Path
from fastapi import HTTPException
from app.modules.hoondok.summary_models import (
    SummaryUnit,
    SummaryRevision,
    SummaryAsset,
    now,
)
from app.modules.hoondok.summary_schemas import (
    SummaryInput,
    SummaryAdminResponse,
    SummaryMediaResponse,
    SummaryListItem,
    SummaryDetail,
    SummaryTocItem,
    SummarySource,
    document_asset_ids,
)

# 경전별 목차 구조(원문 없음). 발행 관리 목록과 원문 뷰 장 연결에 쓴다.
# 천성경은 편·장·절, 평화경은 편·연설문(제4편 14 만 장까지). 평화경 문단 번호는 연설문 안 1부터다.
TOC_DIR = Path(__file__).resolve().parents[3] / "content/ai-summaries"
WORKS = {
    "cheonseong": {"title": "천성경", "toc": "cheonseong-toc.json", "unit": "말씀"},
    "pyeonghwa": {"title": "평화경", "toc": "pyeonghwa-toc.json", "unit": "문단"},
}
STATUSES = ("draft", "review", "published", "withdrawn")


@lru_cache(maxsize=None)
def work_toc(work: str) -> tuple[dict, ...]:
    rows = json.loads((TOC_DIR / WORKS[work]["toc"]).read_text(encoding="utf-8"))
    return tuple(sorted(rows, key=lambda e: e["slug"]))


@lru_cache(maxsize=1)
def toc_index() -> dict[str, tuple[str, dict]]:
    """slug → (경전, 목차 행). 경전마다 slug 접두사가 달라 겹치지 않는다."""
    return {e["slug"]: (work, e) for work in WORKS for e in work_toc(work)}


def toc_entry(slug):
    return toc_index().get(slug, (None, None))[1]


def paragraph_label(slug):
    """근거 번호 이름. 평화경은 공식 문단 번호가 없어 "문단", 나머지는 "말씀"."""
    work = toc_index().get(slug, (None, None))[0]
    return WORKS[work]["unit"] if work else "말씀"


def normalize_status(value):
    status = str(value or "draft").lower()
    return status if status in STATUSES else "draft"


def section_position(sections, entry):
    """원문 뷰 목차 위치. 목차는 편(1)과 그 아래 한 단계(2)까지만 있다 —
    천성경은 절이 속한 장, 평화경은 연설문(제4편 14 의 장은 연설문 위치)이다."""
    if not entry:
        return None

    def norm(text):
        return "".join(str(text).split())

    in_pyeon = False
    for section in sections:
        if section.level == 1:
            in_pyeon = norm(section.title) == norm(entry["pyeon_title"])
        elif in_pyeon and norm(section.title) == norm(
            entry.get("jang_title") or entry.get("item_title") or ""
        ):
            return section.position
    return None


def image_asset_ids(payload):
    return {uuid.UUID(str(i["asset_id"])) for i in payload.get("images", [])}


def chunk_point_id(volume, chunk_index):
    """적재 규칙(pipeline/ingestor.py)과 같은 Qdrant point id."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{volume}:{chunk_index}"))


def linked_evidence(evidence, volume):
    """근거 링크는 연결된 권리의 volume 으로 응답 시점에 만든다 — 저장 값은 다른 volume 일 수 있다."""
    return [
        dict(e, chunk_id=chunk_point_id(volume, e["chunk_index"]))
        if e.get("chunk_index") is not None
        else e
        for e in evidence
    ]


def body_text(node, in_heading=False):
    """제목을 뺀 본문 글자. 기본 본문(제목 + 빈 문단)은 빈 문자열이다."""
    in_heading = in_heading or node.get("type") == "heading"
    text = "" if in_heading else (node.get("text") or "")
    return text + "".join(body_text(c, in_heading) for c in node.get("content", []))


class SummaryService:
    def __init__(self, repo, media_dir, source_client=None):
        self.source_client = source_client
        self.repo = repo
        self.media_dir = Path(media_dir)

    async def unit(self, unit_id, lock=False):
        unit = await self.repo.get(unit_id, lock)
        if not unit:
            raise HTTPException(404, "요약을 찾을 수 없습니다")
        return unit

    def media_url(self, unit_id, asset_id, admin=False):
        prefix = "/admin" if admin else ""
        return f"/api/backend{prefix}/hoondok/ai-summaries/{unit_id}/media/{asset_id}"

    async def admin_item(self, unit):
        assets = [
            self.asset_response(unit.id, a, True)
            for a in await self.repo.assets(unit.id)
        ]
        return SummaryAdminResponse(
            **unit.draft,
            id=unit.id,
            paragraph_label=paragraph_label(unit.slug),
            version=unit.version,
            review_status=normalize_status(unit.review_status),
            published=unit.published_revision_id is not None,
            assets=assets,
            updated_at=unit.updated_at,
        )

    async def admin_toc(self, status=None, pyeon=None, work="cheonseong"):
        """경전 목차 전부에 유닛 상태를 합친다. 유닛이 없으면 status=none."""
        units = {u.slug: u for u in await self.repo.units()}
        rows = []
        for entry in work_toc(work):
            if pyeon is not None and entry["pyeon_no"] != pyeon:
                continue
            unit = units.get(entry["slug"])
            row = SummaryTocItem(**entry)
            if unit:
                generation = unit.draft.get("generation") or {}
                row = row.model_copy(
                    update={
                        "unit_id": unit.id,
                        "status": normalize_status(unit.review_status),
                        "published": unit.published_revision_id is not None,
                        "image_count": len(unit.draft.get("images", [])),
                        "text_score": generation.get("text_score"),
                        "updated_at": unit.updated_at,
                    }
                )
            if status is None or row.status == status:
                rows.append(row)
        return rows

    async def check_right(self, right_id):
        right = await self.repo.right(right_id)
        if not right or right.status != "allowed" or not right.scope_full_text:
            raise HTTPException(404, "요약을 찾을 수 없습니다")
        return right

    async def section_for(self, volume, slug, cache=None):
        entry = toc_entry(slug)
        if entry is None:
            return None
        cache = {} if cache is None else cache
        if volume not in cache:
            cache[volume] = list(await self.repo.sections(volume) or [])
        return section_position(cache[volume], entry)

    def cover_url(self, unit_id, payload):
        images = sorted(
            payload.get("images", []), key=lambda i: i["kind"] != "concept"
        )
        return self.media_url(unit_id, images[0]["asset_id"]) if images else None

    async def list_public(self, right_id=None, volume=None):
        """공개 개정본이 있는 단위만 내보낸다. 작업본·내린 단위는 제목도 노출하지 않는다."""
        result, sections = [], {}
        for unit, revision in await self.repo.published_units(right_id):
            # 권리는 세션 identity map 에 남아 같은 저작물은 한 번만 읽는다.
            right = await self.repo.right(unit.content_right_id)
            if (
                not right
                or right.status != "allowed"
                or not right.scope_full_text
                or (volume is not None and right.volume != volume)
            ):
                continue
            payload = revision.payload
            result.append(
                SummaryListItem(
                    id=unit.id,
                    content_right_id=unit.content_right_id,
                    work_title=right.work_title,
                    slug=unit.slug,
                    group_title=payload["group_title"],
                    position=payload["position"],
                    title=payload["title"],
                    lead=payload["lead"],
                    section_position=await self.section_for(
                        right.volume, unit.slug, sections
                    ),
                    cover_url=self.cover_url(unit.id, payload),
                )
            )
        return sorted(result, key=lambda x: (x.work_title, x.position))

    async def published(self, unit_id):
        unit = await self.unit(unit_id)
        right = await self.check_right(unit.content_right_id)
        revision = (
            await self.repo.revision(unit.published_revision_id)
            if unit.published_revision_id
            else None
        )
        if not revision:
            raise HTTPException(404, "요약을 찾을 수 없습니다")
        return unit, right, revision.payload

    async def detail(self, unit_id):
        unit, right, payload = await self.published(unit_id)
        following = [
            i
            for i in await self.list_public(unit.content_right_id)
            if i.position > payload["position"]
        ]
        used = document_asset_ids(payload["body"]) | image_asset_ids(payload)
        # 공개 응답은 허용 필드만 골라 담는다 — uncertainty·generation·검수 메모는 제외.
        return SummaryDetail(
            id=unit.id,
            content_right_id=unit.content_right_id,
            work_title=right.work_title,
            volume=right.volume,
            slug=unit.slug,
            group_title=payload["group_title"],
            position=payload["position"],
            title=payload["title"],
            lead=payload["lead"],
            key_points=payload["key_points"],
            body=payload["body"],
            body_version=payload.get("body_version", 1),
            paragraph_label=paragraph_label(unit.slug),
            evidence=linked_evidence(payload.get("evidence", []), right.volume),
            reflection_questions=payload.get("reflection_questions", []),
            source=payload["source"],
            section_position=await self.section_for(right.volume, unit.slug),
            cover_url=self.cover_url(unit.id, payload),
            images=[
                dict(**i, url=self.media_url(unit.id, i["asset_id"]))
                for i in payload.get("images", [])
            ],
            assets=[
                self.asset_response(unit.id, asset)
                for asset in await self.repo.assets(unit.id)
                if asset.id in used
            ],
            next_id=following[0].id if following else None,
        )

    async def audit(self, unit, audit, actor, action):
        unit.updated_at = now()
        await self.repo.save(unit)
        await audit.log_audit(
            admin_user_id=actor,
            action=f"ai_summary.{action}",
            target_table="ai_summary_units",
            target_id=unit.id,
            changes={"version": unit.version, "review_status": unit.review_status},
        )
        return await self.admin_item(unit)

    async def resolve_source(self, data):
        if data.source_range_id is None:
            return data
        from app.modules.hoondok.source_repository import SourceRepository
        from app.modules.hoondok.source_service import SourceService
        from app.core.config import settings

        source = await SourceService(
            SourceRepository(self.repo.session),
            self.source_client,
            settings.collection_name,
        ).resolve(
            data.source_range_id, data.source_range_version, data.content_right_id
        )
        # 연결 성공과 운영자의 원문 검수는 별개다. 같은 원문을 명시적으로 확인한 경우만 유지한다.
        confirmed = (
            data.source.verified
            and data.source.text == source.text
            and data.source.sha256 == source.sha256
        )
        source = source.model_copy(update={"verified": confirmed})
        return data.model_copy(update={"source": source})

    async def create(self, data, audit, actor):
        data = await self.resolve_source(data)
        if not data.slug:
            data = data.model_copy(update={"slug": "summary-" + uuid.uuid4().hex[:12]})
        if data.position is None:
            existing = await self.repo.units(data.content_right_id)
            data = data.model_copy(
                update={
                    "position": max(
                        (u.draft.get("position", 0) or 0 for u in existing), default=0
                    )
                    + 1
                }
            )
        if not await self.repo.right(data.content_right_id):
            raise HTTPException(422, "등록된 원문을 선택하세요")
        if data.images or document_asset_ids(data.body):
            raise HTTPException(422, "초안 생성 후 이미지를 업로드하세요")
        unit = SummaryUnit(
            content_right_id=data.content_right_id,
            slug=data.slug,
            draft=data.model_dump(mode="json"),
        )
        return await self.audit(unit, audit, actor, "create")

    def check_version(self, unit, version):
        if unit.version != version:
            raise HTTPException(409, "다른 관리자가 수정했습니다. 다시 불러와 주세요")

    def image_dimensions(self, filename):
        from PIL import Image

        try:
            with Image.open(self.media_dir / filename) as image:
                return image.size
        except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
            return None, None

    def asset_response(self, unit_id, asset, admin=False):
        width, height = self.image_dimensions(getattr(asset, "filename", ""))
        return SummaryMediaResponse(
            id=asset.id,
            mime_type=asset.mime_type,
            url=self.media_url(unit_id, asset.id, admin),
            width=width,
            height=height,
        )

    async def check_assets(self, unit, data):
        owned = {a.id for a in await self.repo.assets(unit.id)}
        body_ids = document_asset_ids(data.body)
        if (
            len({i.asset_id for i in data.images}) != len(data.images)
            or any(i.asset_id not in owned for i in data.images)
            or not body_ids.issubset(owned)
        ):
            raise HTTPException(422, "이 요약에 업로드한 이미지만 사용할 수 있습니다")

    async def update(self, unit_id, data, audit, actor):
        unit = await self.unit(unit_id, True)
        self.check_version(unit, data.version)
        data = data.model_copy(
            update={
                "slug": data.slug or unit.slug,
                "position": data.position
                if data.position is not None
                else unit.draft["position"],
            }
        )
        if data.content_right_id != unit.content_right_id or data.slug != unit.slug:
            raise HTTPException(422, "원문 저작물과 고유 주소는 변경할 수 없습니다")
        stored = unit.draft.get("source") or {}
        if (
            data.source_range_id is not None
            and str(data.source_range_id) == str(unit.draft.get("source_range_id"))
            and data.source_range_version == unit.draft.get("source_range_version")
            and data.source.text == stored.get("text", "")
            and data.source.sha256 == stored.get("sha256", "")
        ):
            # 같은 원문 범위면 원문 대조 없이 저장한다(공개 시 다시 대조). 검수 표시만 반영한다.
            data = data.model_copy(
                update={
                    "source": SummarySource.model_validate(stored).model_copy(
                        update={"verified": data.source.verified}
                    )
                }
            )
        else:
            data = await self.resolve_source(data)
        await self.check_assets(unit, data)
        unit.draft = data.model_dump(mode="json", exclude={"version"})
        unit.review_status = "draft"
        unit.version += 1
        return await self.audit(unit, audit, actor, "update")

    async def verify_source(self, payload):
        from app.core.config import settings
        from app.modules.hoondok.reading_content import _point_id
        from app.modules.search.hybrid import point_to_search_result
        from app.modules.datasource.chunk_merge import merge_with_dedup

        ids = [_point_id(i) for i in payload.source.chunk_ids]
        if any(i is None for i in ids) or len(set(ids)) != len(ids):
            raise HTTPException(422, "원문 범위를 다시 선택해 주세요")
        if self.source_client is None:
            raise HTTPException(503, "원문 연결 검증을 사용할 수 없습니다")
        try:
            records = await self.source_client.retrieve(
                settings.collection_name, ids=ids
            )
        except Exception:
            raise HTTPException(
                503, "원문 연결을 확인할 수 없습니다. 다시 시도하세요"
            ) from None
        right = await self.check_right(payload.content_right_id)
        chunks = sorted(
            [point_to_search_result(p) for p in records], key=lambda p: p.chunk_index
        )
        if len(chunks) != len(ids) or any(c.volume != right.volume for c in chunks):
            raise HTTPException(422, "선택한 책의 원문 범위가 아닙니다")
        indices = [c.chunk_index for c in chunks]
        if indices != list(range(indices[0], indices[0] + len(indices))):
            raise HTTPException(422, "이어지는 원문 범위를 선택해 주세요")
        if [str(c.chunk_id) for c in chunks] != [str(i) for i in ids]:
            raise HTTPException(422, "원문 범위를 읽기 순서에 맞게 다시 선택해 주세요")
        merged = merge_with_dedup(
            main_text=chunks[0].text, before=[], after=[c.text for c in chunks[1:]]
        ).merged_text
        normalize = lambda text: "".join(text.split())
        if normalize(payload.source.text) not in normalize(merged):
            raise HTTPException(422, "원문 내용이 바뀌었습니다. 범위를 다시 선택해 주세요")

    async def action(self, unit_id, data, audit, actor):
        unit = await self.unit(unit_id, True)
        self.check_version(unit, data.version)
        payload = SummaryInput.model_validate(unit.draft)
        status = normalize_status(unit.review_status)
        if data.action == "withdraw":
            if unit.published_revision_id is None:
                raise HTTPException(409, "공개 중인 요약만 내릴 수 있습니다")
            unit.published_revision_id = None
            # 공개 뒤 고친 작업본(draft·review)은 상태를 유지한다 — 내린 뒤 재공개로 검수를 건너뛰지 않게
            if status == "published":
                unit.review_status = "withdrawn"
        elif data.action == "request_review":
            if status != "draft":
                raise HTTPException(409, "초안에서 검수를 요청하세요")
            if (
                not payload.lead.strip()
                or not any(p.strip() for p in payload.key_points)
                or not body_text(payload.body).strip()
            ):
                raise HTTPException(422, "핵심 한 줄·요점·본문을 작성하세요")
            unit.review_status = "review"
        elif data.action == "return_to_draft":
            if status != "review":
                raise HTTPException(409, "검수 중인 요약만 초안으로 되돌릴 수 있습니다")
            unit.review_status = "draft"
        else:
            if status not in ("review", "withdrawn"):
                raise HTTPException(
                    409, "검수 중이거나 내린 요약만 공개할 수 있습니다"
                )
            await self.check_right(unit.content_right_id)
            source = payload.source
            if not source.edition.strip() or not source.locator.strip():
                raise HTTPException(422, "원문 판본과 위치를 확인하세요")
            if source.chunk_ids or source.text.strip():
                # 원문 범위를 연결한 요약은 검수 확인과 실제 원문 대조를 거친다.
                if (
                    not source.verified
                    or not source.text.strip()
                    or not source.chunk_ids
                ):
                    raise HTTPException(
                        422,
                        "원문 범위를 선택하고 내용을 확인한 뒤 검수 완료로 표시해 주세요",
                    )
                payload = await self.resolve_source(payload)
                await self.verify_source(payload)
            elif source.paragraph_from is None or source.paragraph_to is None:
                raise HTTPException(422, "원문 말씀 번호 범위를 확인하세요")
            await self.check_assets(unit, payload)
            if {i.kind for i in payload.images} != {"concept", "scene"} or any(
                not i.alt.strip() for i in payload.images
            ):
                raise HTTPException(
                    422, "대체 텍스트가 있는 개념·장면 그림이 한 장씩 필요합니다"
                )
            revision = SummaryRevision(
                unit_id=unit.id, version=unit.version, payload=unit.draft
            )
            await self.repo.save(revision)
            unit.published_revision_id = revision.id
            unit.review_status = "published"
        unit.version += 1
        return await self.audit(unit, audit, actor, data.action)

    async def upload(self, unit_id, blob, audit, actor):
        unit = await self.unit(unit_id, True)
        if len(blob) > 10 * 1024 * 1024:
            raise HTTPException(413, "이미지는 10MB 이하로 업로드하세요")
        from PIL import Image, UnidentifiedImageError
        from io import BytesIO

        try:
            with Image.open(BytesIO(blob)) as image:
                if image.format not in ("PNG", "JPEG", "WEBP"):
                    raise ValueError("지원하지 않는 이미지 형식")
                if image.width * image.height > 36000000:
                    raise ValueError("이미지 해상도 초과")
                image_format = image.format
                image.verify()
            with Image.open(BytesIO(blob)) as image:
                image.load()
        except (
            UnidentifiedImageError,
            OSError,
            ValueError,
            SyntaxError,
            Image.DecompressionBombError,
        ):
            raise HTTPException(
                422,
                "손상되지 않은 PNG·JPEG·WebP 이미지(3,600만 화소 이하)를 업로드하세요",
            ) from None
        mime, extension = {
            "PNG": ("image/png", "png"),
            "JPEG": ("image/jpeg", "jpg"),
            "WEBP": ("image/webp", "webp"),
        }[image_format]
        asset = SummaryAsset(unit_id=unit.id, mime_type=mime, filename="")
        asset.filename = f"{asset.id}.{extension}"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        path = self.media_dir / asset.filename
        try:
            path.write_bytes(blob)
            await self.repo.save(asset)
            await self.audit(unit, audit, actor, "upload")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return self.asset_response(unit.id, asset, True)

    async def media(self, unit_id, asset_id, admin=False):
        if admin:
            await self.unit(unit_id)
        else:
            _, _, payload = await self.published(unit_id)
            allowed = document_asset_ids(payload["body"]) | image_asset_ids(payload)
            if asset_id not in allowed:
                raise HTTPException(404, "이미지를 찾을 수 없습니다")
        asset = next(
            (a for a in await self.repo.assets(unit_id) if a.id == asset_id), None
        )
        if not asset or not (self.media_dir / asset.filename).is_file():
            raise HTTPException(404, "이미지를 찾을 수 없습니다")
        return self.media_dir / asset.filename, asset.mime_type
