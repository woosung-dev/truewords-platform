"""선택한 원문이 정확히 연결되고 구간 재편성이 기존 스냅샷을 바꾸지 않는지 확인한다."""
import copy
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.modules.qdrant import QdrantPoint
from app.modules.hoondok.source_service import SourceService
from app.modules.hoondok.source_schemas import SourceRangeInput, SourceRangeUpdate, SourceRangeSplit, SourceRangeMerge
from app.modules.hoondok.summary_service import SummaryService


class Repo:
    def __init__(self):
        self.book = SimpleNamespace(id=uuid.uuid4(), volume='등록 원문', work_title='원리강론', status='allowed', scope_full_text=True)
        self.snapshots, self.saved_ranges = {}, {}
    async def books(self): return [self.book] if self.book.status == 'allowed' else []
    async def right(self, id): return self.book if id == self.book.id else None
    async def job(self, volume): return None
    async def sections(self, volume): return [SimpleNamespace(position=1, title='총서', level=1, start_chunk_index=0, end_chunk_index=1)]
    async def snapshot(self, id): return self.snapshots.get(id)
    async def snapshot_by_hash(self, right, fingerprint): return next((s for s in self.snapshots.values() if s.content_right_id == right and s.fingerprint == fingerprint), None)
    async def save_snapshot(self, row): self.snapshots[row.id] = row; return row
    async def save(self, row): self.saved_ranges[row.id] = row; return row
    async def range(self, id, lock=False): return self.saved_ranges.get(id)
    async def ranges(self, right_id=None): return [r for r in self.saved_ranges.values() if not r.archived and (right_id is None or r.content_right_id == right_id)]


@pytest.fixture
def setup():
    repo = Repo()
    paragraphs = [f'{i+1}번째 원문입니다. ' + ('선택한 말씀의 문장을 그대로 보존합니다. ' * 12) for i in range(4)]
    first = '\n\n'.join(paragraphs[:2]); tail = first[-80:]
    second = tail + '\n\n' + '\n\n'.join(paragraphs[2:])
    points = [QdrantPoint(id=str(uuid.uuid4()), score=0, payload={'volume': repo.book.volume, 'chunk_index': i, 'text': text, 'source':['test']}) for i,text in enumerate([first, second])]
    client = AsyncMock()
    client.scroll.return_value = (points, None)
    async def retrieve(collection, ids): return [p for p in points if p.id in [str(i) for i in ids]]
    client.retrieve.side_effect = retrieve
    service = SourceService(repo, client, 'test-collection')
    return service, repo, client, points


async def chosen(service, repo, start=0, end=3):
    info = await service.make_snapshot(repo.book.id)
    blocks = (await service.passages(info.id)).blocks
    return SourceRangeInput(snapshot_id=info.id, start_block_id=blocks[start].id, end_block_id=blocks[end].id, title='행복을 찾는 마음', group_title='총서'), blocks


@pytest.mark.asyncio
async def test_snapshot_is_stable_and_does_not_expose_internal_chunk_addresses(setup):
    svc,repo,client,points = setup
    a = await svc.make_snapshot(repo.book.id)
    b = await svc.make_snapshot(repo.book.id)
    assert a.id == b.id and a.fingerprint == b.fingerprint
    assert a.block_count == 4
    page = await svc.passages(a.id, limit=2)
    assert page.next_offset == 2 and len(page.blocks) == 2
    assert set(page.blocks[0].model_dump()) == {'id','position','label','text','section_id'}
    assert len(repo.snapshots) == 1
    assert a.sections[0].title == '총서'


@pytest.mark.asyncio
async def test_selected_range_generates_exact_legacy_compatible_source(setup):
    svc,repo,client,points = setup
    data,blocks = await chosen(svc,repo)
    result = await svc.create_range(data, AsyncMock(), uuid.uuid4())
    assert result.source.chunk_ids == [p.id for p in points]
    assert result.source.verified is False
    assert result.text.startswith('1번째') and '4번째' in result.text
    assert result.text.count('2번째') == 1
    # 공개 시 사용하는 기존 원문 검증과 동일한 조건을 통과한다.
    payload = SimpleNamespace(source=result.source, content_right_id=repo.book.id)
    await SummaryService(repo, '/unused', client).verify_source(payload)
    resolved = await svc.resolve(result.id, result.version, repo.book.id)
    assert resolved.sha256 == result.source.sha256


@pytest.mark.asyncio
async def test_changed_source_and_old_range_version_are_not_silently_accepted(setup):
    svc,repo,client,points = setup
    data,_ = await chosen(svc,repo)
    result = await svc.create_range(data, AsyncMock(), uuid.uuid4())
    with pytest.raises(HTTPException) as stale:
        await svc.resolve(result.id, result.version+1, repo.book.id)
    assert stale.value.status_code == 409
    points[0].payload['text'] += ' 변경됨'
    with pytest.raises(HTTPException) as changed:
        await svc.resolve(result.id, result.version, repo.book.id)
    assert changed.value.status_code == 409


@pytest.mark.asyncio
async def test_split_merge_preserves_preexisting_snapshot_and_rejects_overlap(setup):
    svc,repo,client,points = setup
    data,blocks = await chosen(svc,repo)
    audit = AsyncMock(); actor=uuid.uuid4()
    original = await svc.create_range(data,audit,actor)
    published_source = copy.deepcopy(original.source.model_dump())
    a,b = await svc.split(original.id, SourceRangeSplit(version=1, after_block_id=blocks[1].id, first_title='앞부분', second_title='뒷부분'), audit,actor)
    assert len(await svc.list_ranges(repo.book.id)) == 2
    assert repo.saved_ranges[original.id].archived
    assert published_source == original.source.model_dump()
    merged = await svc.merge(a.id, SourceRangeMerge(version=1, other_id=b.id, other_version=1, title='함께 읽기'), audit,actor)
    assert merged.text == original.text
    assert len(await svc.list_ranges(repo.book.id)) == 1
    with pytest.raises(HTTPException) as again:
        await svc.split(a.id, SourceRangeSplit(version=1, after_block_id=blocks[0].id, first_title='하나', second_title='둘'),audit,actor)
    assert again.value.status_code == 409


@pytest.mark.asyncio
async def test_range_update_version_and_book_scope(setup):
    svc,repo,client,points = setup
    data,blocks = await chosen(svc,repo)
    audit=AsyncMock();actor=uuid.uuid4()
    result=await svc.create_range(data,audit,actor)
    changed=await svc.update_range(result.id,SourceRangeUpdate(**data.model_dump(),version=1),audit,actor)
    assert changed.version==2
    with pytest.raises(HTTPException) as stale:
        await svc.update_range(result.id,SourceRangeUpdate(**data.model_dump(),version=1),audit,actor)
    assert stale.value.status_code==409
    with pytest.raises(HTTPException) as other:
        await svc.resolve(result.id,2,uuid.uuid4())
    assert other.value.status_code==422


@pytest.mark.asyncio
async def test_invalid_tokens_missing_chunks_and_withdrawal_fail_closed(setup):
    svc,repo,client,points=setup
    data,blocks=await chosen(svc,repo)
    bad=data.model_copy(update={'end_block_id':str(uuid.uuid4())})
    with pytest.raises(HTTPException) as token:
        await svc.create_range(bad,AsyncMock(),uuid.uuid4())
    assert token.value.status_code==422
    points[1].payload['chunk_index']=3
    with pytest.raises(HTTPException) as gap: await svc.make_snapshot(repo.book.id)
    assert gap.value.status_code==409
    repo.book.status='withdrawn'
    with pytest.raises(HTTPException) as denied: await svc.passages(data.snapshot_id)
    assert denied.value.status_code==404

@pytest.mark.asyncio
async def test_http_persistence_and_summary_binding_require_explicit_unchanged_verification(setup, tmp_path, monkeypatch):
    import httpx
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlmodel import SQLModel
    from app.main import app
    from app.core.config import settings
    from app.modules.hoondok.models import ContentRight, VolumeSection
    from app.modules.hoondok.source_models import SourceSnapshot, SourceRange
    from app.modules.hoondok.summary_models import SummaryUnit, SummaryRevision, SummaryAsset
    from app.modules.pipeline.ingestion_models import IngestionJob
    from app.modules.admin.models import AdminAuditLog
    from app.modules.admin.service import AdminService
    from app.modules.admin.repository import AdminRepository
    from app.modules.admin.dependencies import get_current_admin, get_admin_service, require_admin_gate
    from app.modules.hoondok.source_router import service as source_provider
    from app.modules.hoondok.summary_router import service as summary_provider
    from app.modules.hoondok.source_repository import SourceRepository
    from app.modules.hoondok.summary_repository import SummaryRepository
    _, fake, client, _ = setup
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/source.db')
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all,tables=[ContentRight.__table__,VolumeSection.__table__,IngestionJob.__table__,SourceSnapshot.__table__,SourceRange.__table__,SummaryUnit.__table__,SummaryRevision.__table__,SummaryAsset.__table__,AdminAuditLog.__table__])
    factory=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr(settings,'collection_name','test-collection')
    async with factory() as session:
        session.add(ContentRight(id=fake.book.id,volume=fake.book.volume,work_title=fake.book.work_title,status='allowed',scope_full_text=True))
        await session.commit()
        sources=SourceService(SourceRepository(session),client,'test-collection')
        summaries=SummaryService(SummaryRepository(session),tmp_path/'media',client)
        providers={source_provider:lambda:sources,summary_provider:lambda:summaries,get_current_admin:lambda:{'user_id':uuid.UUID(int=1)},get_admin_service:lambda:AdminService(AdminRepository(session)),require_admin_gate:lambda:{}}
        app.dependency_overrides.update(providers)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Requested-With':'XMLHttpRequest'}) as http:
                snapshot=await http.post(f'/admin/hoondok/source-books/{fake.book.id}/snapshots')
                assert snapshot.status_code==200, snapshot.text
                assert snapshot.headers['cache-control']=='private, no-store'
                sid=snapshot.json()['id']
                block_response=await http.get(f'/admin/hoondok/source-snapshots/{sid}/passages')
                blocks=block_response.json()['blocks']
                response=await http.post('/admin/hoondok/source-ranges',json={'snapshot_id':sid,'start_block_id':blocks[0]['id'],'end_block_id':blocks[-1]['id'],'title':'선택한 원문','group_title':'총서'})
                assert response.status_code==201,response.text
                saved=response.json()
                assert saved['source']['verified'] is False
                payload={'content_right_id':str(fake.book.id),'title':'새 글','source_range_id':saved['id'],'source_range_version':saved['version'],'source':copy.deepcopy(saved['source'])}
                post=await http.post('/admin/hoondok/ai-summaries',json=payload)
                assert post.status_code==201,post.text
                post=post.json();uid=post['id']
                assert post['source']['text']==saved['source']['text']
                assert post['source']['verified'] is False
                assert post['slug'].startswith('summary-') and post['position']==1
                payload['version']=post['version'];payload['source']['verified']=True
                confirmed=await http.put(f'/admin/hoondok/ai-summaries/{uid}',json=payload)
                assert confirmed.status_code==200,confirmed.text
                assert confirmed.json()['source']['verified'] is True
                payload['version']=confirmed.json()['version'];payload['source']['text']='원문을 바꾼 입력';payload['source']['sha256']=''
                changed=await http.put(f'/admin/hoondok/ai-summaries/{uid}',json=payload)
                assert changed.status_code==200,changed.text
                assert changed.json()['source']['text']==saved['source']['text']
                assert changed.json()['source']['verified'] is False
                updated=await http.put(f"/admin/hoondok/source-ranges/{saved['id']}",json={k:saved[k] for k in ['snapshot_id','start_block_id','end_block_id','title','group_title','version']})
                assert updated.status_code==200,updated.text
                payload['version']=changed.json()['version']
                stale=await http.put(f'/admin/hoondok/ai-summaries/{uid}',json=payload)
                assert stale.status_code==409
        finally:
            for provider in providers: app.dependency_overrides.pop(provider,None)
    await engine.dispose()


@pytest.mark.asyncio
async def test_source_endpoints_require_admin_and_csrf():
    import httpx
    from app.main import app
    from app.modules.admin.dependencies import get_current_admin,require_admin_gate
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        assert (await client.get('/admin/hoondok/source-books')).status_code==401
        app.dependency_overrides[get_current_admin]=lambda:{'user_id':uuid.uuid4()}
        app.dependency_overrides[require_admin_gate]=lambda:{}
        try:
            assert (await client.post('/admin/hoondok/source-ranges',json={})).status_code==403
        finally:
            app.dependency_overrides.pop(get_current_admin,None)
            app.dependency_overrides.pop(require_admin_gate,None)

@pytest.mark.asyncio
async def test_exact_character_range_uses_unicode_codepoints_and_preserves_legacy_verification(setup):
    svc,repo,client,points=setup
    points[0].payload['text']='하늘🌿과 마음. '+points[0].payload['text']
    data,blocks=await chosen(svc,repo)
    block=blocks[0]
    start=block.text.index('🌿')
    result=await svc.create_range(data.model_copy(update={'start_block_id':block.id,'end_block_id':block.id,'start_offset':start,'end_offset':start+1}),AsyncMock(),uuid.uuid4())
    assert result.text=='🌿'
    assert result.first==result.last=='🌿'
    assert result.start_offset==2 and result.end_offset==3
    assert result.source.verified is False
    await SummaryService(repo,'/unused',client).verify_source(SimpleNamespace(source=result.source,content_right_id=repo.book.id))


@pytest.mark.asyncio
@pytest.mark.parametrize('start,end',[(0,0),(5,4),(100000,None),(0,100000)])
async def test_invalid_character_ranges_fail_without_saving(setup,start,end):
    svc,repo,client,points=setup
    data,blocks=await chosen(svc,repo)
    invalid=data.model_copy(update={'end_block_id':blocks[0].id,'start_offset':start,'end_offset':end})
    with pytest.raises(HTTPException) as error: await svc.create_range(invalid,AsyncMock(),uuid.uuid4())
    assert error.value.status_code==422 and not repo.saved_ranges


@pytest.mark.asyncio
async def test_partial_same_block_split_and_merge_preserve_exact_outer_boundaries(setup):
    svc,repo,client,points=setup
    data,blocks=await chosen(svc,repo)
    block=blocks[0];actor=uuid.uuid4();audit=AsyncMock()
    original=await svc.create_range(data.model_copy(update={'end_block_id':block.id,'start_offset':2,'end_offset':20}),audit,actor)
    first,second=await svc.split(original.id,SourceRangeSplit(version=1,after_block_id=block.id,after_offset=10,first_title='앞쪽 글',second_title='뒤쪽 글'),audit,actor)
    assert first.start_offset==2 and first.end_offset==10
    assert second.start_offset==10 and second.end_offset==20
    assert first.text+second.text==original.text
    merged=await svc.merge(first.id,SourceRangeMerge(version=1,other_id=second.id,other_version=1,title='다시 합친 글'),audit,actor)
    assert merged.start_offset==2 and merged.end_offset==20 and merged.text==original.text
    assert original.source.verified is False


@pytest.mark.asyncio
async def test_same_block_gap_or_overlap_cannot_be_merged(setup):
    svc,repo,client,points=setup
    data,blocks=await chosen(svc,repo)
    audit=AsyncMock();actor=uuid.uuid4();block=blocks[0]
    first=await svc.create_range(data.model_copy(update={'end_block_id':block.id,'start_offset':0,'end_offset':10}),audit,actor)
    for offset in [9,11]:
        other=await svc.create_range(data.model_copy(update={'end_block_id':block.id,'start_offset':offset,'end_offset':20}),audit,actor)
        with pytest.raises(HTTPException) as error:
            await svc.merge(first.id,SourceRangeMerge(version=1,other_id=other.id,other_version=1,title='합치기'),audit,actor)
        assert error.value.status_code==422
