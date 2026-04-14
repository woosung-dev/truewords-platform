"""RAG 데이터 적재 (Data Ingestion) 관련 관리자 API 라우터."""

import asyncio
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
from src.datasource.schemas import CategoryDocumentStats, VolumeInfo, VolumeTagRequest, VolumeTagResponse
from src.datasource.service import DataSourceCategoryService
from src.pipeline.chunker import chunk_text
from src.pipeline.dependencies import get_ingestion_service
from src.pipeline.extractor import extract_text
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestion_service import IngestionJobService
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import extract_metadata
from src.qdrant_client import get_client

router = APIRouter(prefix="/admin/data-sources", tags=["data-sources"])

# 즉시 모드 업로드 워커 큐 (TPM 한도 준수 + 스레드 풀 보호)
# FastAPI BackgroundTasks는 병렬 실행되어 Semaphore로 직렬화하면 대기 태스크들이
# 스레드 풀을 점유해 HTTP 응답이 느려짐. 대신 Queue + 전용 워커 1개로 처리.
_INGEST_QUEUE: "queue.Queue[tuple]" = queue.Queue(maxsize=100)
_WORKER_STARTED = threading.Event()
_WORKER_LOCK = threading.Lock()


def _ingest_worker():
    """즉시 모드 파일을 Queue에서 하나씩 꺼내 처리하는 전용 워커."""
    logger.info("[ingest-worker] 워커 시작")
    while True:
        try:
            task = _INGEST_QUEUE.get()
            if task is None:
                break
            file_path, filename, source = task
            try:
                _process_file_standard(file_path, filename, source)
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


def _process_file(file_path: Path, filename: str, source: str, mode: str = "standard"):
    """BackgroundTask 진입점. 배치 모드는 즉시 처리, 즉시 모드는 워커 큐에 투입."""
    if mode == "batch":
        _process_file_batch(file_path, filename, source)
    else:
        _ensure_worker()
        _INGEST_QUEUE.put((file_path, filename, source))
        logger.info("[%s] 처리 큐에 투입 (대기열 %d개)", filename, _INGEST_QUEUE.qsize())


def _process_file_batch(file_path: Path, filename: str, source: str):
    """배치 모드: Gemini Batch API에 즉시 제출."""
    volume_key = unicodedata.normalize("NFC", filename)

    try:
        logger.info("[%s] 배치 모드 처리 시작", volume_key)
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
                await svc.submit(chunks_texts=chunk_texts, filename=filename,
                                 volume_key=volume_key, source=source)

        asyncio.run(_submit_batch())
        logger.info("[%s] 배치 작업 제출 완료 (%d청크)", volume_key, len(chunks))
    except Exception:
        logger.exception("[%s] 배치 처리 실패", volume_key)
    finally:
        if file_path.exists():
            file_path.unlink()


def _process_file_standard(file_path: Path, filename: str, source: str):
    """즉시 모드: 전용 워커에서 호출. 청크 추출 → 임베딩 → Qdrant 적재.

    워커 스레드 내에서 전용 event loop를 생성하여 DB 호출에 재사용.
    각 상태 전이는 짧은 트랜잭션으로 커밋되어 race 없음.
    """
    volume_key = unicodedata.normalize("NFC", filename)
    loop = asyncio.new_event_loop()

    def run_repo(fn):
        """Repository 작업을 짧은 트랜잭션으로 실행."""
        async def _exec():
            async with async_session_factory() as session:
                repo = IngestionJobRepository(session)
                result = await fn(repo)
                await repo.commit()
                return result
        return loop.run_until_complete(_exec())

    try:
        run_repo(lambda r: r.upsert_pending(volume_key, filename, source))

        logger.info("[%s] 처리 시작 (file_path=%s)", volume_key, file_path)

        # 1. 텍스트 추출
        text = extract_text(file_path)
        logger.info("[%s] 텍스트 추출 완료 (%d자)", volume_key, len(text))
        if not text.strip():
            run_repo(lambda r: r.fail_job(volume_key, "빈 파일"))
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

        # 6. 임베딩 + 적재 (upsert마다 on_progress 콜백으로 DB 갱신)
        def on_progress(abs_processed: int):
            run_repo(lambda r: r.update_progress(volume_key, abs_processed))

        stats = ingest_chunks(
            sync_client, settings.collection_name, chunks,
            start_chunk=start_chunk, title=meta["title"],
            on_progress=on_progress,
        )

        # 7. 최종 상태 전이
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

    except Exception as e:
        logger.exception("[%s] 처리 실패", volume_key)
        try:
            run_repo(lambda r: r.fail_job(volume_key, str(e)))
        except Exception:
            logger.exception("[%s] 실패 상태 기록도 실패", volume_key)
    finally:
        loop.close()
        if file_path.exists():
            file_path.unlink()


@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source: str = Form("", description="데이터 소스 카테고리 key (비워두면 미분류로 적재)"),
    mode: str = Form("standard", description="처리 모드: standard | batch"),
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """업로드된 파일을 백그라운드에서 RAG 지식 베이스로 적재합니다."""
    if mode not in ("standard", "batch"):
        raise HTTPException(status_code=400, detail="mode는 standard 또는 batch만 가능합니다")
    if mode == "batch" and settings.gemini_tier != "paid":
        raise HTTPException(status_code=400, detail="배치 처리는 유료 티어에서만 사용 가능합니다")

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

    background_tasks.add_task(_process_file, tmp_path, safe_filename, source, mode)
    return {"message": "파일 업로드 및 처리 예약 완료", "filename": safe_filename, "mode": mode}


@router.get("/status")
async def get_ingest_status(
    current_admin: dict = Depends(get_current_admin),
    service: IngestionJobService = Depends(get_ingestion_service),
):
    """현재까지 처리된 적재 작업 상태를 반환합니다."""
    return await service.build_status_response()


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
    return qdrant_service.get_all_volumes()


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
