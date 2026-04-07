"""RAG 데이터 적재 (Data Ingestion) 관련 관리자 API 라우터."""

import logging
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

logger = logging.getLogger(__name__)

from src.admin.dependencies import get_current_admin
from src.config import settings
from src.datasource.dependencies import get_datasource_service
from src.datasource.service import DataSourceCategoryService
from src.pipeline.chunker import chunk_text
from src.pipeline.extractor import extract_text
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import extract_metadata
from src.pipeline.progress import ProgressTracker
from src.qdrant_client import get_client

router = APIRouter(prefix="/admin/data-sources", tags=["data-sources"])

_PROGRESS_FILE = Path(__file__).parent.parent.parent / "progress.json"

def _process_file(file_path: Path, filename: str, source: str):
    """백그라운드에서 파일 청크 및 임베딩 처리."""
    tracker = ProgressTracker(_PROGRESS_FILE)
    volume_key = filename

    try:
        logger.info("[%s] 처리 시작 (file_path=%s)", volume_key, file_path)

        # 1. 텍스트 추출
        text = extract_text(file_path)
        logger.info("[%s] 텍스트 추출 완료 (%d자)", volume_key, len(text))
        if not text.strip():
            tracker.mark_failed(volume_key, "빈 파일")
            return

        # 2. 메타데이터 (title, date 등). 파일명 기반 추출을 기본으로 사용.
        meta = extract_metadata(file_path, text)
        volume = meta["volume"] or volume_key

        # 3. 문서 청킹
        chunks = chunk_text(
            text,
            volume=volume,
            max_chars=500,
            source=source,
            title=meta["title"],
            date=meta["date"],
        )
        logger.info("[%s] 청킹 완료 (%d개 청크)", volume_key, len(chunks))

        # 4. 재개 지점 확인 (청크 레벨 체크포인트)
        start_chunk = tracker.get_resume_point(volume_key)
        if start_chunk > 0:
            logger.info("[%s] 청크 %d번부터 재개 (총 %d청크)", volume_key, start_chunk, len(chunks))

        # 5. Qdrant 적재
        client = get_client()
        stats = ingest_chunks(
            client,
            settings.collection_name,
            chunks,
            start_chunk=start_chunk,
            title=meta["title"],
            tracker=tracker,
            volume_key=volume_key,
        )
        logger.info("[%s] 적재 완료 (%d청크, %.1f초)",
                    volume_key, stats["chunk_count"], stats["elapsed_sec"])

        # 6. 성공 기록 (in_progress 자동 삭제)
        tracker.mark_completed(volume_key, stats["chunk_count"])

    except Exception as e:
        logger.exception("[%s] 처리 실패", volume_key)
        tracker.mark_failed(volume_key, str(e))
    finally:
        # 임시 파일 삭제
        if file_path.exists():
            file_path.unlink()

@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source: str = Form(..., description="데이터 소스 카테고리 key"),
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """업로드된 파일을 백그라운드에서 RAG 지식 베이스로 적재합니다."""
    # source 유효성 검증 (DB 등록된 카테고리만 허용)
    category = await datasource_service.get_by_key(source)
    if not category or not category.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"유효하지 않은 데이터 소스입니다: {source}",
        )

    # 파일명 sanitize (path traversal 방지)
    safe_filename = Path(file.filename or "unknown").name  # 디렉토리 경로 제거
    if not safe_filename or safe_filename.startswith("."):
        raise HTTPException(status_code=400, detail="유효하지 않은 파일명입니다")

    # 파일 크기 제한 (50MB)
    max_size = 50 * 1024 * 1024
    if file.size and file.size > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"파일 크기가 50MB를 초과합니다 ({file.size // 1024 // 1024}MB)",
        )

    # 확장자 검증
    allowed_extensions = {".txt", ".pdf", ".docx"}
    ext = Path(safe_filename).suffix.lower()

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. (지원: {', '.join(allowed_extensions)})"
        )
    
    # 임시 파일로 저장
    try:
        suffix = Path(safe_filename).suffix
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            file.file.seek(0)  # 안전장치: 대형 파일 SpooledTemporaryFile 위치 보장
            shutil.copyfileobj(file.file, tmp_file)
            tmp_path = Path(tmp_file.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    # 파일 닫기
    file.file.close()

    # completed/failed 초기화. in_progress는 유지 → 재업로드 시 중단 지점부터 재개
    tracker = ProgressTracker(_PROGRESS_FILE)
    if safe_filename in tracker.completed:
        del tracker.completed[safe_filename]
    if safe_filename in tracker.failed:
        del tracker.failed[safe_filename]
    tracker.save()

    # 백그라운드 태스크 큐 추가
    background_tasks.add_task(_process_file, tmp_path, safe_filename, source)

    return {"message": "파일 업로드 및 처리 예약 완료", "filename": safe_filename}

@router.get("/status")
async def get_ingest_status(current_admin: dict = Depends(get_current_admin)):
    """현재까지 처리된 progress.json 상태를 반환합니다."""
    tracker = ProgressTracker(_PROGRESS_FILE)
    summary = tracker.get_summary()
    return {
        "completed": tracker.completed,
        "failed": tracker.failed,
        "summary": summary
    }
