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

logger = logging.getLogger(__name__)

from src.admin.dependencies import get_current_admin
from src.common.database import async_session_factory
from src.config import settings
from src.datasource.dependencies import get_datasource_service, get_qdrant_service
from src.datasource.qdrant_service import DataSourceQdrantService
from src.datasource.schemas import (
    CategoryDocumentStats,
    DuplicateCheckResponse,
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
from src.pipeline.chunker import chunk_recursive
from src.pipeline.dependencies import get_ingestion_service
from src.pipeline.extractor import extract_text
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestion_service import IngestionJobService
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import extract_metadata
from src.qdrant_client import get_raw_client

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


def _resolve_upload_strategy(
    *,
    on_duplicate: str,
    existing_status: str | None,
    existing_processed_chunks: int,
    existing_total_chunks: int,
    existing_content_hash: str | None,
    existing_chunk_count: int,
    existing_sources: list[str],
    new_source: str,
    new_hash: str,
) -> dict:
    """ADR-30 재업로드 정책의 분기 결정을 한 번에 계산하는 순수 함수.

    ``_process_file_standard``에서 IO/임베딩과 분리해 호출함으로써 Codex P1/P2
    수정사항(reset / total_chunks 보존 / skip 단축 / payload union)을 mock 없는
    단위 테스트로 잠글 수 있다.

    Args:
        on_duplicate: "merge" | "replace" | "skip".
        existing_status: 기존 IngestionJob.status.value (없으면 None).
        existing_processed_chunks: 기존 row의 processed_chunks (skip 단축 복구용).
        existing_total_chunks: 기존 row의 total_chunks (없으면 0).
        existing_content_hash: 기존 row의 content_hash (없으면 None).
        existing_chunk_count: Qdrant에 적재된 청크 수.
        existing_sources: Qdrant payload.source 합집합 (NFC/NFD 정규화 후).
        new_source: 이번 업로드의 source.
        new_hash: 이번 추출 텍스트의 SHA-256.

    Returns:
        dict with:
          - skip_short_circuit (bool): True면 임베딩 건너뛰고 complete_job 복구.
          - needs_reset (bool): True면 Qdrant 청크 삭제 + start_chunk=0.
          - payload_sources (list[str] | None): ingest_chunks에 전달할 source 리스트.
              None이면 chunk.source([source])를 그대로 사용.
          - preserved_processed (int): skip 단축 시 복구할 processed_chunks.
          - preserved_total (int): skip 단축 시 복구할 total_chunks.
    """
    is_completed = existing_status == "completed"

    # skip + COMPLETED + processed > 0 + hash 일치 → 임베딩 건너뜀.
    skip_short_circuit = (
        on_duplicate == "skip"
        and is_completed
        and existing_processed_chunks > 0
        and existing_content_hash is not None
        and existing_content_hash == new_hash
    )
    if skip_short_circuit:
        preserved_processed = existing_processed_chunks
        preserved_total = existing_total_chunks or preserved_processed
        return {
            "skip_short_circuit": True,
            "needs_reset": False,
            "payload_sources": None,
            "preserved_processed": preserved_processed,
            "preserved_total": preserved_total,
        }

    # COMPLETED + Qdrant chunks > 0 → reset (기존 청크 삭제 후 0부터 적재).
    # PARTIAL/RUNNING은 재개 의도라 reset하지 않는다.
    needs_reset = is_completed and existing_chunk_count > 0

    # payload_sources 정책:
    # - merge: 기존 ∪ 신규 (existing_sources는 reset 직전 스냅샷)
    # - skip(여기 도달 = hash 불일치 fallback): merge와 동일 정책으로 분류 보존
    # - replace: None → ingest_chunks가 chunk.source([source])를 그대로 사용
    payload_sources: list[str] | None = None
    if on_duplicate in ("merge", "skip"):
        union = {s for s in existing_sources if s}
        if new_source:
            union.add(new_source)
        payload_sources = sorted(union) if union else None

    return {
        "skip_short_circuit": False,
        "needs_reset": needs_reset,
        "payload_sources": payload_sources,
        "preserved_processed": 0,
        "preserved_total": 0,
    }

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
    """BackgroundTask 진입점. standard 워커 큐에 투입.

    ADR-30 follow-up: on_duplicate 정책 (merge/replace/skip) 적용.
    Batch API 모드는 polling 인프라 미완성으로 제거됨 (PR #95). standard 즉시
    처리만 지원.
    """
    _ = mode  # 호환성 유지 — 인자 보존, 항상 standard 동작
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
    svc = DataSourceQdrantService(get_raw_client(), settings.collection_name)
    return await svc.get_volume_snapshot(volume_key)


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
        # ADR-30 follow-up: 모든 모드에서 기존 job을 먼저 조회 (skip 단축 + reset 판단용)
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

        new_hash = _compute_content_hash(text)

        # 2. 메타데이터 + volume 정규화 (NFC) — _get_existing_snapshot도 같은 키로 조회한다.
        meta = extract_metadata(file_path, text)
        volume = unicodedata.normalize("NFC", meta["volume"] or volume_key)

        # 3. ADR-30 정책 분기 — Qdrant 스냅샷(reset 직전) + helper로 결정.
        existing_sources, existing_chunk_count = run_async(_get_existing_snapshot(volume))
        strategy = _resolve_upload_strategy(
            on_duplicate=on_duplicate,
            existing_status=existing_job.status.value if existing_job else None,
            existing_processed_chunks=existing_job.processed_chunks if existing_job else 0,
            existing_total_chunks=existing_job.total_chunks if existing_job else 0,
            existing_content_hash=existing_job.content_hash if existing_job else None,
            existing_chunk_count=existing_chunk_count,
            existing_sources=existing_sources,
            new_source=source,
            new_hash=new_hash,
        )

        # 4. skip 단축 — 임베딩/upsert 생략 + COMPLETED + total_chunks 복구 (Codex P2).
        if strategy["skip_short_circuit"]:
            preserved_processed = strategy["preserved_processed"]
            preserved_total = strategy["preserved_total"]
            logger.info(
                "[%s] skip + COMPLETED + content_hash 일치(%d/%d청크) → 임베딩 생략 (Gemini 호출 0회)",
                volume_key, preserved_processed, preserved_total,
            )
            run_repo(
                lambda r: r.complete_job(
                    volume_key, preserved_processed, total_chunks=preserved_total
                )
            )
            run_repo(lambda r: r.update_content_hash(volume_key, new_hash))
            return

        # 5. 문서 청킹 — Phase 2.4 운영 기본 (dev-log 51) Recursive 700/150
        # + Phase 3 dev-log 53 권고 — book_series 자동 분류
        from src.pipeline.metadata import classify_book_series
        book_series = classify_book_series(file_path)
        chunks = chunk_recursive(text, volume=volume, source=source,
                                 title=meta["title"], date=meta["date"])
        if book_series:
            for c in chunks:
                c.book_series = book_series
        logger.info(
            "[%s] 청킹 완료 (%d개 청크, recursive, book_series=%r)",
            volume_key, len(chunks), book_series,
        )

        # 6. ADR-30 P1: COMPLETED 재업로드는 reset 후 0부터 적재. start_chunk 자동 재개를
        #    그대로 두면 같은 길이 재업로드 시 effective_chunks=[]로 빠져 silent no-op 발생.
        if strategy["needs_reset"]:
            from src.pipeline.ingestor import _sync_delete_by_filter

            _sync_delete_by_filter(
                settings.collection_name,
                {"must": [{"key": "volume", "match": {"value": volume}}]},
            )
            logger.info(
                "[%s] 재업로드 reset: 기존 %d청크 삭제 + start_chunk=0 (on_duplicate=%s)",
                volume_key, existing_chunk_count, on_duplicate,
            )
            start_chunk = 0
        else:
            start_chunk = existing_chunk_count
            if start_chunk > 0:
                logger.info(
                    "[%s] Qdrant %d청크 확인 → %d번부터 재개 (총 %d청크)",
                    volume_key, start_chunk, start_chunk, len(chunks),
                )

        # 7. RUNNING 상태 + total_chunks 저장
        run_repo(lambda r: r.start_run(volume_key, total_chunks=len(chunks)))
        if start_chunk > 0:
            run_repo(lambda r: r.update_progress(volume_key, start_chunk))

        # 7-bis. content_hash 즉시 저장 — Root cause fix (PR #99).
        # 기존엔 COMPLETED 분기 (line 393) 에서만 저장되어 PARTIAL/FAILED 시 NULL.
        # 결과: 부분 적재 후 재업로드 시 hash 비교 불가 → analyze 우회 등 부수 작업 유발.
        # start_run 직후 저장하면 모든 상태에서 hash 보존, 재개 시 자동 일치 확인 가능.
        # 하단 line 394 의 호출은 멱등으로 보존 (같은 hash 재저장 — 안전).
        run_repo(lambda r: r.update_content_hash(volume_key, new_hash))

        # 8. payload_sources는 strategy가 결정 (merge/skip union or None)
        payload_sources = strategy["payload_sources"]
        if payload_sources is not None:
            logger.info(
                "[%s] %s 정책: 기존 source=%s + 신규 '%s' → 적재 source=%s",
                volume_key, on_duplicate, existing_sources, source, payload_sources,
            )

        # 9. 임베딩 + 적재 (upsert마다 on_progress 콜백으로 DB 갱신)
        def on_progress(abs_processed: int):
            run_repo(lambda r: r.update_progress(volume_key, abs_processed))

        stats = ingest_chunks(
            settings.collection_name, chunks,
            start_chunk=start_chunk, title=meta["title"],
            on_progress=on_progress,
            payload_sources=payload_sources,
        )

        # 10. 최종 상태 전이
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
            run_repo(
                lambda r: r.complete_job(
                    volume_key, len(chunks), total_chunks=len(chunks)
                )
            )
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


def _predict_outcome(
    on_duplicate: str,
    existing_status: str | None,
    existing_chunk_count: int,
) -> str:
    """ADR-30 follow-up: 업로드 시점에 처리 예상 동작을 노출 (UI 토스트용).

    실제 처리는 background에서 일어나며, skip은 hash가 다르면 merge로 fallback.
    여기서는 가장 가능성 높은 outcome을 반환한다.
    """
    exists = existing_status is not None or existing_chunk_count > 0
    if not exists:
        return "new"
    if on_duplicate == "skip" and existing_status == "completed":
        return "skip"
    if on_duplicate == "replace":
        return "replace"
    return "merge"


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
    # mode 인자는 후방 호환을 위해 받지만 Batch API 제거 후 항상 standard 동작.
    _ = mode
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
    """
    qdrant_result = await qdrant_service.delete_volumes([volume_key])
    chunks_deleted = qdrant_result.total_chunks_deleted

    ingestion_deleted = False
    async with async_session_factory() as session:
        ing_repo = IngestionJobRepository(session)
        ingestion_deleted = await ing_repo.delete_by_volume_key(
            unicodedata.normalize("NFC", volume_key)
        )
        await session.commit()

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
