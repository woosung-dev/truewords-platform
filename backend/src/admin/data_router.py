"""RAG 데이터 적재 (Data Ingestion) 관련 관리자 API 라우터.

audit P0-8 fix (2026-05-15): 기존 866 줄 파일을 router (본 모듈) + ingest_service
(파일 처리 로직) + ingest_worker (queue/thread state) 로 3분할. router 는 HTTP
endpoint + delete_volume_artifacts 만. backward compat 을 위해 test 가 사용하던
내부 helper (`_compute_content_hash`, `_predict_outcome`, `_process_file_standard`,
`set_main_loop`) 는 re-export.
"""

import logging
import shutil
import unicodedata
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

logger = logging.getLogger(__name__)

from src.admin.dependencies import get_current_admin, verify_csrf
from src.admin.ingest_service import (
    _compute_content_hash,
    _get_existing_snapshot,
    _predict_outcome,
    _resolve_upload_strategy,
    process_file_standard as _process_file_standard,
)
from src.admin.ingest_worker import (
    enqueue_file_ingestion as _process_file,
    set_main_loop,
)
from src.config import settings
from src.datasource.dependencies import get_datasource_service, get_qdrant_service
from src.datasource.qdrant_service import DataSourceQdrantService
from src.datasource.schemas import (
    CategoryDocumentStats,
    DuplicateCheckResponse,
    IngestionJobInfo,
    UpdateDisplayNameRequest,
    UploadResponse,
    VolumeDeleteRequest,
    VolumeDeleteResponse,
    VolumeInfo,
    VolumeTagRequest,
    VolumeTagResponse,
    VolumeTagsBulkRequest,
    VolumeTagsBulkResponse,
)
from src.datasource.service import DataSourceCategoryService
from src.pipeline.dependencies import get_ingestion_service, ingestion_service_session_scope
from src.pipeline.ingestion_service import IngestionJobService
from src.qdrant_client import get_raw_client

# 재업로드 정책 (ADR-30) — merge / replace / skip
_VALID_ON_DUPLICATE = ("merge", "replace", "skip")

# audit 2차 C-2 (2026-05-15): destructive POST/PUT/PATCH/DELETE 8 routes 에
# verify_csrf 일괄 적용. GET endpoint 에서는 verify_csrf 내부 분기로 noop.
router = APIRouter(
    prefix="/admin/data-sources",
    tags=["data-sources"],
    dependencies=[Depends(verify_csrf)],
)


__all__ = [
    "router",
    "set_main_loop",
    # backward-compat for tests
    "_compute_content_hash",
    "_predict_outcome",
    "_resolve_upload_strategy",
    "_process_file_standard",
    "_process_file",
    "_get_existing_snapshot",
]


@router.post("/upload", status_code=202, response_model=UploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source: str = Form("", description="데이터 소스 카테고리 key (비워두면 미분류로 적재)"),
    mode: str = Form("standard", description="호환용 (Batch API 제거됨, 항상 standard)"),
    on_duplicate: str = Form(
        "merge",
        description=(
            "재업로드 정책 (ADR-30). merge: 기존 카테고리 ∪ 신규 (default), "
            "replace: 신규로 통째 교체, skip: COMPLETED 동일 파일이면 임베딩 생략."
        ),
    ),
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
    ingestion_service: IngestionJobService = Depends(get_ingestion_service),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
) -> UploadResponse:
    """업로드된 파일을 백그라운드에서 RAG 지식 베이스로 적재합니다."""
    _ = mode  # 호환성 유지 — 인자 보존, 항상 standard 동작
    if on_duplicate not in _VALID_ON_DUPLICATE:
        raise HTTPException(
            status_code=400,
            detail=f"on_duplicate는 {_VALID_ON_DUPLICATE} 중 하나여야 합니다",
        )

    if source:
        category = await datasource_service.get_by_key(source)
        if not category or not category.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"유효하지 않은 데이터 소스입니다: {source}",
            )

    safe_filename = Path(file.filename or "unknown").name
    if not safe_filename or safe_filename.startswith("."):
        raise HTTPException(status_code=400, detail="유효하지 않은 파일명입니다")

    max_size = 50 * 1024 * 1024
    if file.size and file.size > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"파일 크기가 50MB를 초과합니다 ({file.size // 1024 // 1024}MB)",
        )

    allowed_extensions = {".txt", ".pdf", ".docx"}
    ext = Path(safe_filename).suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. (지원: {', '.join(allowed_extensions)})"
        )

    # ADR-30 follow-up: 처리 예상 outcome을 사전에 노출. 실제 결과는 polling으로 확인.
    volume_key = unicodedata.normalize("NFC", safe_filename)
    existing_job = await ingestion_service.find_by_filename(safe_filename)
    _, existing_chunk_count = await qdrant_service.get_volume_snapshot(volume_key)
    predicted = _predict_outcome(
        on_duplicate=on_duplicate,
        existing_status=existing_job.status.value if existing_job else None,
        existing_chunk_count=existing_chunk_count,
    )

    try:
        suffix = Path(safe_filename).suffix
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            file.file.seek(0)
            shutil.copyfileobj(file.file, tmp_file)
            tmp_path = Path(tmp_file.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    file.file.close()

    background_tasks.add_task(
        _process_file, tmp_path, safe_filename, source, mode, on_duplicate
    )
    return UploadResponse(
        message="파일 업로드 및 처리 예약 완료",
        filename=safe_filename,
        volume_key=volume_key,
        mode=mode,
        on_duplicate=on_duplicate,
        predicted_outcome=predicted,
    )


@router.get("/status")
async def get_ingest_status(
    current_admin: dict = Depends(get_current_admin),
    service: IngestionJobService = Depends(get_ingestion_service),
):
    """현재까지 처리된 적재 작업 상태를 반환합니다.

    summary 의 핵심 카운터는 ingestion_jobs 이력이 아니라 Qdrant 컬렉션의 실제
    상태로 덮어쓴다. 운영 데이터 이관 등으로 이력이 비어 있어도 "검색 가능한
    데이터셋" 의 실제 규모가 UI 에 정직하게 반영되도록 한다.

      summary.total_chunks    = Qdrant 총 포인트 수
      summary.completed_count = Qdrant 고유 volume 수 (= 인제스트 완료된 파일)
      summary.failed_count    = ingestion_jobs 중 FAILED 건 (실제 실패만)
      프론트의 총파일 = completed_count + failed_count
    """
    response = await service.build_status_response()
    try:
        client = get_raw_client()
        total = await client.count(settings.collection_name)
        response["summary"]["total_chunks"] = total
        # volume facet 1회로 고유 volume 수 파악 (hits 길이)
        vol_facet = await client.facet(
            settings.collection_name,
            key="volume",
            limit=10000,
        )
        response["summary"]["completed_count"] = len(vol_facet)
    except Exception:
        # Qdrant 일시 실패 시 ingestion_jobs 기반 값을 그대로 노출
        pass
    return response


@router.get("/check-duplicate", response_model=DuplicateCheckResponse)
async def check_duplicate(
    filename: str,
    current_admin: dict = Depends(get_current_admin),
    service: IngestionJobService = Depends(get_ingestion_service),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """업로드 전 동일 파일명의 기존 적재 여부를 조회합니다.

    UI는 응답을 보고 사용자에게 ADR-30의 4가지 결정을 노출한다:
      - merge   : 콘텐츠 갱신 + 기존 카테고리 보존 (default 권장)
      - replace : 신규 카테고리로 통째 교체
      - add-tag : 임베딩 없이 카테고리 태그만 추가 (volume-tags API)
      - cancel  : 업로드 중단
    """
    if not filename.strip():
        raise HTTPException(status_code=400, detail="filename이 비어있습니다")

    safe_filename = Path(filename).name
    volume_key = unicodedata.normalize("NFC", safe_filename)

    job = await service.find_by_filename(safe_filename)
    sources, chunk_count = await qdrant_service.get_volume_snapshot(volume_key)

    exists = job is not None or chunk_count > 0
    status_value = job.status.value if job else None
    last_uploaded_at = job.updated_at if job else None
    stored_filename = job.filename if job else safe_filename
    # 8자리 partial — 식별용. start_run 직후 저장 (PR #99) 이라 PARTIAL/RUNNING 도 보존됨.
    content_hash_partial = (
        job.content_hash[:8] if job and job.content_hash else None
    )

    return DuplicateCheckResponse(
        exists=exists,
        volume_key=volume_key,
        filename=stored_filename,
        sources=sources,
        chunk_count=chunk_count,
        status=status_value,
        last_uploaded_at=last_uploaded_at,
        content_hash=content_hash_partial,
        processed_chunks=job.processed_chunks if job else 0,
        total_chunks=job.total_chunks if job else 0,
    )


@router.get("/category-stats", response_model=list[CategoryDocumentStats])
async def get_category_stats(
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """카테고리별 Qdrant 문서/청크 통계를 반환합니다."""
    categories = await datasource_service.list_all()
    if not categories:
        return []
    category_keys = {cat.key for cat in categories}
    return await qdrant_service.get_category_stats(category_keys)


@router.get("/volumes", response_model=list[VolumeInfo])
async def get_all_volumes(
    current_admin: dict = Depends(get_current_admin),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """전체 volume 목록 조회 — Transfer UI용."""
    return await qdrant_service.get_all_volumes()


@router.get("/jobs", response_model=list[IngestionJobInfo])
async def list_ingestion_jobs(
    current_admin: dict = Depends(get_current_admin),
    ingestion_service: IngestionJobService = Depends(get_ingestion_service),
) -> list[IngestionJobInfo]:
    """파일별 IngestionJob 목록 — admin display_name 인라인 편집 화면용.

    기존 ``/status`` 는 progress 추적 dict 포맷이라 volume_key/display_name 노출이
    어려워 별도 list 엔드포인트로 분리한다.
    """
    jobs = await ingestion_service.list_jobs()
    return [
        IngestionJobInfo(
            volume_key=job.volume_key,
            filename=job.filename,
            source=job.source,
            display_name=job.display_name,
            status=job.status.value,
            total_chunks=job.total_chunks,
        )
        for job in jobs
    ]


@router.patch("/display-name", response_model=IngestionJobInfo)
async def update_display_name(
    request: UpdateDisplayNameRequest,
    current_admin: dict = Depends(get_current_admin),
    ingestion_service: IngestionJobService = Depends(get_ingestion_service),
) -> IngestionJobInfo:
    """파일별 사용자 친화적 표시명 갱신.

    chat 응답의 출처 카드/원문 모달이 display_name 을 우선 노출한다. None/빈 문자열은
    "미설정" 으로 정규화 — chat UI 가 기존 volume/source 로 fallback.
    """
    job = await ingestion_service.update_display_name(
        volume_key=request.volume_key,
        display_name=request.display_name,
    )
    if job is None:
        raise HTTPException(
            status_code=404, detail=f"volume_key '{request.volume_key}' 를 찾을 수 없습니다"
        )
    return IngestionJobInfo(
        volume_key=job.volume_key,
        filename=job.filename,
        source=job.source,
        display_name=job.display_name,
        status=job.status.value,
        total_chunks=job.total_chunks,
    )


@router.put("/volume-tags", response_model=VolumeTagResponse)
async def add_volume_tag(
    request: VolumeTagRequest,
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """문서에 카테고리 태그를 추가합니다."""
    category = await datasource_service.get_by_key(request.source)
    if not category:
        raise HTTPException(status_code=404, detail=f"카테고리 '{request.source}'를 찾을 수 없습니다")
    return await qdrant_service.add_volume_tag(request.volume, request.source)


@router.delete("/volume-tags", response_model=VolumeTagResponse)
async def remove_volume_tag(
    request: VolumeTagRequest,
    current_admin: dict = Depends(get_current_admin),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """문서에서 카테고리 태그를 제거합니다."""
    try:
        return await qdrant_service.remove_volume_tag(request.volume, request.source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/volume-tags/bulk", response_model=VolumeTagsBulkResponse)
async def add_volume_tags_bulk(
    request: VolumeTagsBulkRequest,
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """여러 문서에 카테고리 태그를 한 번에 추가합니다."""
    category = await datasource_service.get_by_key(request.source)
    if not category:
        raise HTTPException(status_code=404, detail=f"카테고리 '{request.source}'를 찾을 수 없습니다")
    return await qdrant_service.add_volume_tags_bulk(request.volumes, request.source)


@router.post("/volume-tags/bulk-remove", response_model=VolumeTagsBulkResponse)
async def remove_volume_tags_bulk(
    request: VolumeTagsBulkRequest,
    current_admin: dict = Depends(get_current_admin),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """여러 문서에서 카테고리 태그를 한 번에 제거합니다.

    DELETE + body는 일부 클라이언트/프록시에서 문제 가능성이 있어 POST로 운영.
    """
    return await qdrant_service.remove_volume_tags_bulk(request.volumes, request.source)


# ---------------------------------------------------------------------------
# Volume(파일) 영구 삭제 — Qdrant 청크 + IngestionJob row + BatchJob row 일괄 정리.
# 운영자가 잘못 적재했거나 더 이상 학습에 사용하지 않을 파일을 깨끗이 제거하는 용도.
# 되돌릴 수 없는 destructive 작업이므로 UI는 typed-confirm 패턴 권장.
# ---------------------------------------------------------------------------


async def _delete_volume_artifacts(
    volume_key: str,
    qdrant_service: DataSourceQdrantService,
) -> dict:
    """단일 volume에 대해 Qdrant + IngestionJob + BatchJob 모두 삭제.

    순서: Qdrant 먼저(검색에 즉시 영향) → DB. Qdrant 실패 시 DB는 건드리지 않아
    Qdrant↔DB 불일치를 최소화한다. DB 단계 실패는 Qdrant cleanup 후이므로 다음
    재시도/재업로드로 자연 정리된다.

    audit P0-5 fix (2026-05-15): DB 단계는 `ingestion_service_session_scope` factory
    + `IngestionJobService.delete_by_volume_key` 로 이관. Router 가 session/repo
    인스턴스화 + commit 직접 호출하던 룰 §3 위반 해소.
    """
    qdrant_result = await qdrant_service.delete_volumes([volume_key])
    chunks_deleted = qdrant_result.total_chunks_deleted

    async with ingestion_service_session_scope() as ingestion_service:
        ingestion_deleted = await ingestion_service.delete_by_volume_key(
            unicodedata.normalize("NFC", volume_key)
        )

    return {
        "volume": volume_key,
        "chunks_deleted": chunks_deleted,
        "ingestion_row_deleted": ingestion_deleted,
        # batch_rows_deleted 0 — Batch API 제거 후 자리 보존 (PR #95).
        "batch_rows_deleted": 0,
        "skipped": qdrant_result.skipped,
    }


@router.delete(
    "/volumes/{volume_key:path}",
    response_model=VolumeDeleteResponse,
    summary="단일 volume 영구 삭제",
)
async def delete_volume(
    volume_key: str,
    current_admin: dict = Depends(get_current_admin),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """volume(파일) 한 건을 영구 삭제합니다.

    - Qdrant의 모든 청크 삭제 (NFC/NFD 둘 다 매칭)
    - PostgreSQL의 ``IngestionJob`` row 삭제
    - 같은 volume의 ``BatchJob`` row 모두 삭제

    되돌릴 수 없는 destructive 작업입니다. UI는 typed-confirm 패턴으로 사용자
    의사를 한 번 더 확인할 것을 권장합니다.
    """
    if not volume_key.strip():
        raise HTTPException(status_code=400, detail="volume_key가 비어있습니다")

    result = await _delete_volume_artifacts(volume_key, qdrant_service)
    deleted = bool(result["chunks_deleted"]) or result["ingestion_row_deleted"] or bool(
        result["batch_rows_deleted"]
    )
    skipped: list[dict] = []
    if not deleted:
        skipped.append({"volume": volume_key, "reason": "Qdrant/DB 어디에도 데이터 없음"})

    logger.warning(
        "[delete_volume] %s — chunks=%d ingestion=%s batch=%d (admin=%s)",
        volume_key,
        result["chunks_deleted"],
        result["ingestion_row_deleted"],
        result["batch_rows_deleted"],
        current_admin.get("username") if isinstance(current_admin, dict) else current_admin,
    )

    return VolumeDeleteResponse(
        deleted_volumes=[volume_key] if deleted else [],
        total_chunks_deleted=result["chunks_deleted"],
        skipped=skipped,
    )


@router.post(
    "/volumes/delete-bulk",
    response_model=VolumeDeleteResponse,
    summary="다수 volume 영구 삭제 (bulk)",
)
async def delete_volumes_bulk(
    request: VolumeDeleteRequest,
    current_admin: dict = Depends(get_current_admin),
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
):
    """다수 volume을 한 번에 영구 삭제합니다.

    DELETE + body는 일부 클라이언트/프록시에서 문제 가능성이 있어 POST로 운영
    (``volume-tags/bulk-remove``와 동일 패턴).
    """
    deleted_volumes: list[str] = []
    total_chunks = 0
    skipped: list[dict] = []
    for vol in request.volumes:
        try:
            result = await _delete_volume_artifacts(vol, qdrant_service)
        except Exception as e:
            logger.exception("[delete_volumes_bulk] %s 삭제 실패", vol)
            skipped.append({"volume": vol, "reason": f"오류: {e}"})
            continue
        if result["chunks_deleted"] or result["ingestion_row_deleted"] or result["batch_rows_deleted"]:
            deleted_volumes.append(vol)
            total_chunks += result["chunks_deleted"]
        else:
            skipped.append({"volume": vol, "reason": "Qdrant/DB 어디에도 데이터 없음"})

    logger.warning(
        "[delete_volumes_bulk] requested=%d deleted=%d chunks=%d skipped=%d (admin=%s)",
        len(request.volumes),
        len(deleted_volumes),
        total_chunks,
        len(skipped),
        current_admin.get("username") if isinstance(current_admin, dict) else current_admin,
    )

    return VolumeDeleteResponse(
        deleted_volumes=sorted(deleted_volumes),
        total_chunks_deleted=total_chunks,
        skipped=skipped,
    )


# /batch-jobs 엔드포인트 제거됨 (PR #95) — Gemini Batch API 폴링 인프라
# 미완성으로 인해 batch 모드 결과가 영구 미반영되는 결함 발견. 즉시 처리
# (standard) 모드만 운영 지원.
