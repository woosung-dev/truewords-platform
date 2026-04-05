"""RAG 데이터 적재 (Data Ingestion) 관련 관리자 API 라우터."""

import os
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
import sys

from src.admin.dependencies import get_current_admin
from src.config import settings
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
        # 1. 텍스트 추출
        text = extract_text(file_path)
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

        # 4. Qdrant 적재
        client = get_client()
        stats = ingest_chunks(client, settings.collection_name, chunks)

        # 5. 성공 기록
        tracker.mark_completed(volume_key, stats["chunk_count"])

    except Exception as e:
        tracker.mark_failed(volume_key, str(e))
    finally:
        # 임시 파일 삭제
        if file_path.exists():
            file_path.unlink()

@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source: str = Form(..., description="데이터 소스 분류 (A, B, C, D)"),
    current_admin: dict = Depends(get_current_admin),
):
    """업로드된 파일을 백그라운드에서 RAG 지식 베이스로 적재합니다."""
    # 확장자 검증
    allowed_extensions = {".txt", ".pdf", ".docx"}
    ext = Path(file.filename or "").suffix.lower()
    
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. (지원: {', '.join(allowed_extensions)})"
        )
    
    # 임시 파일로 저장
    try:
        suffix = Path(file.filename).suffix
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            shutil.copyfileobj(file.file, tmp_file)
            tmp_path = Path(tmp_file.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    # 파일 닫기
    file.file.close()

    # ProgressTracker에 상태 초기화 (진행중 임의 등록은 없으므로 failed/completed만 남음)
    # UI의 즉각적인 피드백을 위해 우선 failed에서 없앰
    tracker = ProgressTracker(_PROGRESS_FILE)
    if file.filename in tracker.completed:
        del tracker.completed[file.filename]
    if file.filename in tracker.failed:
        del tracker.failed[file.filename]
    tracker._save()

    # 백그라운드 태스크 큐 추가
    background_tasks.add_task(_process_file, tmp_path, file.filename, source)

    return {"message": "파일 업로드 및 처리 예약 완료", "filename": file.filename}

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
