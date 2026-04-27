"""RAG 데이터 적재 (Data Ingestion) 관련 관리자 API 라우터."""

import asyncio
import hashlib
import logging
import queue
import shutil
import threading
import unicodedata
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from qdrant_client.models import FieldCondition, Filter, MatchValue

logger = logging.getLogger(__name__)

from src.admin.dependencies import get_current_admin
from src.common.database import async_session_factory
from src.config import settings
from src.datasource.dependencies import get_datasource_service, get_qdrant_service
from src.datasource.qdrant_service import DataSourceQdrantService
from src.datasource.schemas import (
    CategoryDocumentStats,
    DuplicateCheckResponse,
    VolumeInfo,
    VolumeTagRequest,
    VolumeTagResponse,
    VolumeTagsBulkRequest,
    VolumeTagsBulkResponse,
)
from src.datasource.service import DataSourceCategoryService
from src.pipeline.chunker import chunk_text
from src.pipeline.dependencies import get_ingestion_service
from src.pipeline.extractor import extract_text
from src.pipeline.ingestion_models import IngestionStatus
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestion_service import IngestionJobService
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import extract_metadata
from src.qdrant_client import get_async_client, get_client

# 재업로드 정책 (ADR-30) — merge: 기존 source ∪ 신규, replace: 신규로 교체,
# skip: COMPLETED 동일 파일이면 임베딩/upsert 모두 건너뜀.
_VALID_ON_DUPLICATE = ("merge", "replace", "skip")


def _compute_content_hash(text: str) -> str:
    """추출된 원본 텍스트의 SHA-256 hex digest.

    skip 모드(ADR-30 follow-up)에서 동일 파일명이라도 콘텐츠가 변경되었는지
    판단하는 진실 원점. UTF-8 인코딩의 raw 바이트 기반 — NFC/NFD 정규화 여부는
    호출자가 결정.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

router = APIRouter(prefix="/admin/data-sources", tags=["data-sources"])

# 즉시 모드 업로드 워커 큐 (TPM 한도 준수 + 스레드 풀 보호)
# FastAPI BackgroundTasks는 병렬 실행되어 Semaphore로 직렬화하면 대기 태스크들이
# 스레드 풀을 점유해 HTTP 응답이 느려짐. 대신 Queue + 전용 워커 1개로 처리.
_INGEST_QUEUE: "queue.Queue[tuple]" = queue.Queue(maxsize=100)
_WORKER_STARTED = threading.Event()
_WORKER_LOCK = threading.Lock()

# FastAPI 메인 event loop 참조 — 워커 스레드가 DB 호출을 메인 loop에 위임한다.
# AsyncEngine의 connection pool은 단일 loop에 바인딩되므로 워커가 직접 새 loop로
# 접근하면 "attached to a different loop" 런타임 에러 발생. lifespan에서 주입.
_main_loop: "asyncio.AbstractEventLoop | None" = None


def set_main_loop(loop: "asyncio.AbstractEventLoop") -> None:
    """FastAPI lifespan에서 호출. 메인 loop을 워커가 쓸 수 있도록 저장."""
    global _main_loop
    _main_loop = loop


def _ingest_worker():
    """즉시 모드 파일을 Queue에서 하나씩 꺼내 처리하는 전용 워커."""
    logger.info("[ingest-worker] 워커 시작")
    while True:
        try:
            task = _INGEST_QUEUE.get()
            if task is None:
                break
            file_path, filename, source, on_duplicate = task
            try:
                _process_file_standard(file_path, filename, source, on_duplicate)
            except Exception:
                logger.exception("[ingest-worker] 처리 중 예외")
            finally:
                _INGEST_QUEUE.task_done()
        except Exception:
            logger.exception("[ingest-worker] 워커 루프 예외")


def _ensure_worker():
    """워커 스레드가 없으면 시작 (멀티 요청에 안전)."""
    with _WORKER_LOCK:
        if not _WORKER_STARTED.is_set():
            t = threading.Thread(target=_ingest_worker, name="ingest-worker", daemon=True)
            t.start()
            _WORKER_STARTED.set()


def _process_file(
    file_path: Path,
    filename: str,
    source: str,
    mode: str = "standard",
    on_duplicate: str = "merge",
):
    """BackgroundTask 진입점. 배치 모드는 즉시 처리, 즉시 모드는 워커 큐에 투입.

    ADR-30 follow-up: batch/standard 둘 다 on_duplicate를 따른다.
    standard는 content_hash 기반 정밀 비교, batch는 Qdrant chunk_count > 0
    여부로 단순 비교(BatchJob에 hash 컬럼 추가는 후속 작업).
    """
    if mode == "batch":
        _process_file_batch(file_path, filename, source, on_duplicate)
    else:
        _ensure_worker()
        _INGEST_QUEUE.put((file_path, filename, source, on_duplicate))
        logger.info(
            "[%s] 처리 큐에 투입 (대기열 %d개, on_duplicate=%s)",
            filename, _INGEST_QUEUE.qsize(), on_duplicate,
        )


async def _get_existing_snapshot(volume_key: str) -> tuple[list[str], int]:
    """기존 volume의 (sources, chunk_count) 조회 — 워커가 메인 loop에 위임해 사용.

    DataSourceQdrantService를 직접 인스턴스화한다 (Depends 미사용 컨텍스트).
    NFC/NFD 혼재 대응은 서비스 메서드 내부에서 처리한다.
    """
    async_client = get_async_client()
    sync_client = get_client()
    svc = DataSourceQdrantService(async_client, sync_client, settings.collection_name)
    return await svc.get_volume_snapshot(volume_key)


def _process_file_batch(
    file_path: Path,
    filename: str,
    source: str,
    on_duplicate: str = "merge",
):
    """배치 모드: Gemini Batch API에 즉시 제출.

    ADR-30 follow-up: on_duplicate는 BatchJob.on_duplicate에 저장되어 적재
    시점(``BatchService._ingest_batch_results``)에 payload.source 결정에 사용.
    skip 모드는 Qdrant chunk_count > 0이면 batch 제출 자체 생략(보수적 — hash
    비교는 BatchJob.content_hash 추가 후속 작업).

    DB 호출은 메인 loop에 위임 (AsyncEngine 단일 loop 바인딩 제약).
    """
    volume_key = unicodedata.normalize("NFC", filename)

    if _main_loop is None:
        logger.error("[%s] 메인 loop 미설정 — 배치 처리 불가", volume_key)
        return
    loop = _main_loop  # 클로저 캡처

    try:
        logger.info(
            "[%s] 배치 모드 처리 시작 (on_duplicate=%s)", volume_key, on_duplicate,
        )

        # ADR-30 follow-up: skip 모드 — 이미 Qdrant에 적재된 파일이면 batch 제출 생략.
        if on_duplicate == "skip":
            existing_sources, existing_chunks = asyncio.run_coroutine_threadsafe(
                _get_existing_snapshot(volume_key), loop
            ).result()
            if existing_chunks > 0:
                logger.info(
                    "[%s] skip + Qdrant 청크 %d개 존재(분류 %s) → 배치 제출 생략",
                    volume_key, existing_chunks, existing_sources,
                )
                return

        text = extract_text(file_path)
        if not text.strip():
            logger.warning("[%s] 빈 파일, 배치 제출 생략", volume_key)
            return
        meta = extract_metadata(file_path, text)
        volume = unicodedata.normalize("NFC", meta["volume"] or volume_key)
        chunks = chunk_text(text, volume=volume, max_chars=500, source=source,
                            title=meta["title"], date=meta["date"])

        from src.pipeline.batch_repository import BatchJobRepository
        from src.pipeline.batch_service import BatchService

        chunk_texts = [c.text for c in chunks]

        async def _submit_batch():
            async with async_session_factory() as session:
                repo = BatchJobRepository(session)
                svc = BatchService(repo=repo)
                await svc.submit(
                    chunks_texts=chunk_texts,
                    filename=filename,
                    volume_key=volume_key,
                    source=source,
                    on_duplicate=on_duplicate,
                )

        future = asyncio.run_coroutine_threadsafe(_submit_batch(), loop)
        future.result()
        logger.info(
            "[%s] 배치 작업 제출 완료 (%d청크, on_duplicate=%s)",
            volume_key, len(chunks), on_duplicate,
        )
    except Exception:
        logger.exception("[%s] 배치 처리 실패", volume_key)
    finally:
        if file_path.exists():
            file_path.unlink()


def _process_file_standard(
    file_path: Path,
    filename: str,
    source: str,
    on_duplicate: str = "merge",
):
    """즉시 모드: 전용 워커에서 호출. 청크 추출 → 임베딩 → Qdrant 적재.

    DB 호출은 FastAPI 메인 loop에 위임 (run_coroutine_threadsafe)하여
    AsyncEngine connection pool의 단일 loop 바인딩 제약을 준수한다.

    on_duplicate (ADR-30):
      - merge   : 기존 payload.source ∪ 신규 source 로 union (default).
      - replace : 신규 source 로 통째로 교체 (기존 동작).
      - skip    : 동일 파일이 COMPLETED 상태면 임베딩/upsert 모두 건너뜀.
    """
    volume_key = unicodedata.normalize("NFC", filename)

    if _main_loop is None:
        logger.error("[%s] 메인 loop 미설정 — 워커 실행 불가 (lifespan 초기화 확인)", volume_key)
        return
    loop = _main_loop  # 클로저 캡처 (None narrowing 유지)

    def run_repo(fn):
        """Repository 작업을 메인 loop에 제출하고 결과를 blocking으로 받는다."""
        async def _exec():
            async with async_session_factory() as session:
                repo = IngestionJobRepository(session)
                result = await fn(repo)
                await repo.commit()
                return result
        future = asyncio.run_coroutine_threadsafe(_exec(), loop)
        return future.result()

    def run_async(coro):
        """임의 코루틴을 메인 loop에 제출하고 결과를 blocking으로 받는다."""
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result()

    try:
        # ADR-30: skip 모드는 텍스트 추출 후 content_hash까지 비교해야 정확하므로
        # 기존 job을 보관해 두고 사전 차단은 하지 않는다.
        # PARTIAL/RUNNING은 재개 의도가 명확하므로 이 분기를 통과시켜 이어서 적재.
        existing_job = None
        if on_duplicate == "skip":
            existing_job = run_repo(lambda r: r.get_by_volume_key(volume_key))

        run_repo(lambda r: r.upsert_pending(volume_key, filename, source))

        logger.info(
            "[%s] 처리 시작 (file_path=%s, on_duplicate=%s)",
            volume_key, file_path, on_duplicate,
        )

        # 1. 텍스트 추출
        text = extract_text(file_path)
        logger.info("[%s] 텍스트 추출 완료 (%d자)", volume_key, len(text))
        if not text.strip():
            run_repo(lambda r: r.fail_job(volume_key, "빈 파일"))
            return

        # ADR-30 follow-up: skip + COMPLETED + 콘텐츠 hash 일치면 임베딩/upsert 모두 생략.
        # 처리 진입 시 upsert_pending이 PENDING으로 리셋했으므로 COMPLETED 복구도 수행.
        new_hash = _compute_content_hash(text)
        if (
            on_duplicate == "skip"
            and existing_job is not None
            and existing_job.status == IngestionStatus.COMPLETED
            and existing_job.processed_chunks > 0
            and existing_job.content_hash == new_hash
        ):
            preserved_chunks = existing_job.processed_chunks
            logger.info(
                "[%s] skip + COMPLETED + content_hash 일치(%d청크) → 임베딩 생략 (Gemini 호출 0회)",
                volume_key, preserved_chunks,
            )
            run_repo(lambda r: r.complete_job(volume_key, preserved_chunks))
            run_repo(lambda r: r.update_content_hash(volume_key, new_hash))
            return

        # 2. 메타데이터 추출
        meta = extract_metadata(file_path, text)
        volume = unicodedata.normalize("NFC", meta["volume"] or volume_key)

        # 3. 문서 청킹
        chunks = chunk_text(text, volume=volume, max_chars=500, source=source,
                            title=meta["title"], date=meta["date"])
        logger.info("[%s] 청킹 완료 (%d개 청크)", volume_key, len(chunks))

        # 4. Qdrant에서 재개 지점 조회
        sync_client = get_client()
        start_chunk = sync_client.count(
            collection_name=settings.collection_name,
            count_filter=Filter(must=[
                FieldCondition(key="volume", match=MatchValue(value=volume)),
            ]),
        ).count
        if start_chunk > 0:
            logger.info("[%s] Qdrant %d청크 확인 → %d번부터 재개 (총 %d청크)",
                        volume_key, start_chunk, start_chunk, len(chunks))

        # 5. RUNNING 상태 + total_chunks 저장
        run_repo(lambda r: r.start_run(volume_key, total_chunks=len(chunks)))
        # 재개 지점 반영
        if start_chunk > 0:
            run_repo(lambda r: r.update_progress(volume_key, start_chunk))

        # 6. ADR-30 merge 모드: 기존 payload.source 와 신규 source 합집합 계산.
        # 결과가 비어있으면 None으로 넘겨 ingest_chunks가 chunk.source를 사용하게 한다.
        payload_sources: list[str] | None = None
        if on_duplicate == "merge":
            existing_sources, _ = run_async(_get_existing_snapshot(volume_key))
            union = {s for s in existing_sources if s}
            if source:
                union.add(source)
            payload_sources = sorted(union) if union else None
            if payload_sources:
                logger.info(
                    "[%s] merge 정책: 기존 source=%s + 신규 '%s' → 적재 source=%s",
                    volume_key, existing_sources, source, payload_sources,
                )

        # 7. 임베딩 + 적재 (upsert마다 on_progress 콜백으로 DB 갱신)
        def on_progress(abs_processed: int):
            run_repo(lambda r: r.update_progress(volume_key, abs_processed))

        stats = ingest_chunks(
            sync_client, settings.collection_name, chunks,
            start_chunk=start_chunk, title=meta["title"],
            on_progress=on_progress,
            payload_sources=payload_sources,
        )

        # 8. 최종 상태 전이
        final_processed = start_chunk + stats["chunk_count"]
        if stats.get("is_partial"):
            logger.warning(
                "[%s] 부분 적재 (%d/%d청크, %.1f초) — 재업로드로 이어서 처리 가능",
                volume_key, stats["chunk_count"], stats["total_chunks"], stats["elapsed_sec"],
            )
            run_repo(lambda r: r.mark_partial(volume_key, final_processed))
        else:
            logger.info("[%s] 적재 완료 (%d청크, %.1f초)",
                        volume_key, stats["chunk_count"], stats["elapsed_sec"])
            run_repo(lambda r: r.complete_job(volume_key, len(chunks)))
            # ADR-30 follow-up: 완전 적재 성공 시에만 hash 기록 (PARTIAL은 콘텐츠 일부만
            # 반영된 상태라 후속 skip 비교에서 사용하면 부정확).
            run_repo(lambda r: r.update_content_hash(volume_key, new_hash))

    except Exception as e:
        logger.exception("[%s] 처리 실패", volume_key)
        try:
            run_repo(lambda r: r.fail_job(volume_key, str(e)))
        except Exception:
            logger.exception("[%s] 실패 상태 기록도 실패", volume_key)
    finally:
        if file_path.exists():
            file_path.unlink()


@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source: str = Form("", description="데이터 소스 카테고리 key (비워두면 미분류로 적재)"),
    mode: str = Form("standard", description="처리 모드: standard | batch"),
    on_duplicate: str = Form(
        "merge",
        description=(
            "재업로드 정책 (ADR-30). merge: 기존 카테고리 ∪ 신규 (default), "
            "replace: 신규로 통째 교체, skip: COMPLETED 동일 파일이면 임베딩 생략. "
            "mode=batch에서는 무시된다."
        ),
    ),
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """업로드된 파일을 백그라운드에서 RAG 지식 베이스로 적재합니다."""
    if mode not in ("standard", "batch"):
        raise HTTPException(status_code=400, detail="mode는 standard 또는 batch만 가능합니다")
    if mode == "batch" and settings.gemini_tier != "paid":
        raise HTTPException(status_code=400, detail="배치 처리는 유료 티어에서만 사용 가능합니다")
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
    return {
        "message": "파일 업로드 및 처리 예약 완료",
        "filename": safe_filename,
        "mode": mode,
        "on_duplicate": on_duplicate,
    }


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
        client = get_async_client()
        count_info = await client.count(collection_name=settings.collection_name)
        response["summary"]["total_chunks"] = count_info.count
        # volume facet 1회로 고유 volume 수 파악 (hits 길이)
        vol_facet = await client.facet(
            collection_name=settings.collection_name,
            key="volume",
            limit=10000,
        )
        response["summary"]["completed_count"] = len(vol_facet.hits)
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

    return DuplicateCheckResponse(
        exists=exists,
        volume_key=volume_key,
        filename=stored_filename,
        sources=sources,
        chunk_count=chunk_count,
        status=status_value,
        last_uploaded_at=last_uploaded_at,
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


@router.get("/batch-jobs")
async def list_batch_jobs(
    current_admin: dict = Depends(get_current_admin),
):
    """배치 작업 목록 조회."""
    from src.pipeline.batch_repository import BatchJobRepository

    async with async_session_factory() as session:
        repo = BatchJobRepository(session)
        jobs = await repo.list_recent(limit=20)

    return [
        {
            "id": str(job.id),
            "batch_id": job.batch_id,
            "filename": job.filename,
            "source": job.source,
            "total_chunks": job.total_chunks,
            "status": job.status.value,
            "error_message": job.error_message,
            "created_at": job.created_at.isoformat(),
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
        for job in jobs
    ]
