# Embedding Batch API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini Batch API를 활용한 듀얼 모드 임베딩 파이프라인 — 관리자가 즉시/배치 처리를 선택하여 비용 50% 절감

**Architecture:** 기존 `_process_file()`의 청킹까지는 공유하고, 임베딩 단계에서 Standard API / Batch API로 분기한다. BatchJob 테이블로 비동기 작업 상태를 추적하고, 백그라운드 폴링으로 완료 시 Qdrant 적재.

**Tech Stack:** FastAPI, Gemini Batch API (google-genai), SQLModel/Alembic, Qdrant, Next.js (Admin UI)

**Design Spec:** `docs/superpowers/specs/2026-04-11-embedding-batch-api-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/src/pipeline/batch_embedder.py` | Gemini Batch API 제출/폴링/결과 처리 |
| Create | `backend/src/pipeline/batch_models.py` | BatchJob, BatchStatus SQLModel |
| Create | `backend/src/pipeline/batch_repository.py` | BatchJob DB CRUD |
| Create | `backend/src/pipeline/batch_service.py` | 배치 오케스트레이션 (제출→폴링→적재) |
| Create | `backend/tests/test_batch_models.py` | BatchJob 모델 테스트 |
| Create | `backend/tests/test_batch_service.py` | 배치 서비스 테스트 |
| Create | `backend/alembic/versions/xxxx_add_batch_jobs.py` | 마이그레이션 |
| Modify | `backend/src/admin/router.py:114` | GET /admin/settings/config 추가 |
| Modify | `backend/src/admin/data_router.py:91-152` | upload에 mode 파라미터 + batch-jobs 엔드포인트 |
| Modify | `admin/src/app/(dashboard)/data-sources/page.tsx` | 모드 선택 UI + 배치 상태 섹션 |

---

### Task 1: BatchJob 모델 + 마이그레이션

**Files:**
- Create: `backend/src/pipeline/batch_models.py`
- Create: `backend/tests/test_batch_models.py`
- Create: `backend/alembic/versions/xxxx_add_batch_jobs.py`

- [ ] **Step 1: 실패 테스트 작성 — BatchJob 모델 기본 동작**

```python
# backend/tests/test_batch_models.py
"""BatchJob 모델 단위 테스트."""

from src.pipeline.batch_models import BatchJob, BatchStatus


def test_batch_job_default_status():
    job = BatchJob(
        batch_id="batch-123",
        filename="test.pdf",
        volume_key="test.pdf",
        source="L",
        total_chunks=100,
    )
    assert job.status == BatchStatus.PENDING
    assert job.error_message is None
    assert job.completed_at is None


def test_batch_status_values():
    assert BatchStatus.PENDING == "pending"
    assert BatchStatus.PROCESSING == "processing"
    assert BatchStatus.COMPLETED == "completed"
    assert BatchStatus.FAILED == "failed"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/test_batch_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.pipeline.batch_models'`

- [ ] **Step 3: BatchJob 모델 구현**

```python
# backend/src/pipeline/batch_models.py
"""Batch 임베딩 작업 DB 모델."""

import enum
import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import Text


class BatchStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class BatchJob(SQLModel, table=True):
    __tablename__ = "batch_jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    batch_id: str = Field(index=True)
    filename: str
    volume_key: str
    source: str = ""
    total_chunks: int = 0
    status: BatchStatus = Field(default=BatchStatus.PENDING, index=True)
    error_message: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    completed_at: datetime | None = None
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/test_batch_models.py -v`
Expected: 2 passed

- [ ] **Step 5: Alembic 마이그레이션 생성**

Run: `source backend/.venv/bin/activate && cd backend && alembic revision --autogenerate -m "add batch_jobs table"`

생성된 마이그레이션 파일에서 batch_jobs 테이블 생성만 남기고 불필요한 변경 제거.

- [ ] **Step 6: 커밋**

```bash
git add backend/src/pipeline/batch_models.py backend/tests/test_batch_models.py backend/alembic/versions/
git commit -m "feat: add BatchJob model and migration"
```

---

### Task 2: BatchJob Repository

**Files:**
- Create: `backend/src/pipeline/batch_repository.py`

- [ ] **Step 1: Repository 구현**

```python
# backend/src/pipeline/batch_repository.py
"""BatchJob DB CRUD."""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.pipeline.batch_models import BatchJob, BatchStatus


class BatchJobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, job: BatchJob) -> BatchJob:
        self.session.add(job)
        await self.session.flush()
        return job

    async def get_by_batch_id(self, batch_id: str) -> BatchJob | None:
        stmt = select(BatchJob).where(BatchJob.batch_id == batch_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_status(self, *statuses: BatchStatus) -> list[BatchJob]:
        stmt = (
            select(BatchJob)
            .where(BatchJob.status.in_(statuses))
            .order_by(BatchJob.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_recent(self, limit: int = 20) -> list[BatchJob]:
        stmt = (
            select(BatchJob)
            .order_by(BatchJob.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update_status(
        self, job: BatchJob, status: BatchStatus, error_message: str | None = None
    ) -> BatchJob:
        job.status = status
        if error_message is not None:
            job.error_message = error_message
        if status == BatchStatus.COMPLETED or status == BatchStatus.FAILED:
            from datetime import datetime
            job.completed_at = datetime.utcnow()
        self.session.add(job)
        await self.session.flush()
        return job

    async def commit(self) -> None:
        await self.session.commit()
```

- [ ] **Step 2: 커밋**

```bash
git add backend/src/pipeline/batch_repository.py
git commit -m "feat: add BatchJob repository"
```

---

### Task 3: Batch Embedder (Gemini Batch API 래퍼)

**Files:**
- Create: `backend/src/pipeline/batch_embedder.py`
- Create: `backend/tests/test_batch_embedder.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/test_batch_embedder.py
"""Batch Embedder 단위 테스트."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.pipeline.batch_embedder import (
    prepare_batch_input,
    submit_batch_job,
    check_batch_status,
)


def test_prepare_batch_input_creates_jsonl(tmp_path):
    """청크 텍스트를 JSONL 파일로 변환."""
    texts = ["참사랑이란", "축복의 의미", "천일국 건설"]
    output_path = prepare_batch_input(texts, tmp_path / "batch.jsonl")

    assert output_path.exists()
    lines = output_path.read_text().strip().split("\n")
    assert len(lines) == 3
    first = json.loads(lines[0])
    assert "contents" in first
    assert first["contents"] == "참사랑이란"


def test_prepare_batch_input_empty_texts(tmp_path):
    """빈 텍스트 리스트일 때 빈 파일 생성."""
    output_path = prepare_batch_input([], tmp_path / "empty.jsonl")
    assert output_path.exists()
    assert output_path.read_text() == ""
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/test_batch_embedder.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Batch Embedder 구현**

```python
# backend/src/pipeline/batch_embedder.py
"""Gemini Batch API 래퍼 — 배치 임베딩 제출/폴링/결과 처리."""

import json
import logging
from pathlib import Path

from google import genai
from google.genai import types
from src.config import settings

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())

EMBEDDING_MODEL = "gemini-embedding-001"


def prepare_batch_input(texts: list[str], output_path: Path) -> Path:
    """청크 텍스트를 Gemini Batch API 입력 JSONL로 변환.

    Args:
        texts: 임베딩할 텍스트 리스트.
        output_path: JSONL 파일 저장 경로.

    Returns:
        저장된 JSONL 파일 경로.
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for text in texts:
            line = json.dumps(
                {
                    "contents": text,
                    "config": {
                        "task_type": "RETRIEVAL_DOCUMENT",
                        "output_dimensionality": 1536,
                    },
                },
                ensure_ascii=False,
            )
            f.write(line + "\n")
    return output_path


def submit_batch_job(input_path: Path) -> str:
    """Gemini Batch API에 임베딩 작업 제출.

    Args:
        input_path: prepare_batch_input으로 생성한 JSONL 파일 경로.

    Returns:
        batch_id (Gemini가 반환하는 작업 식별자).

    Raises:
        Exception: API 제출 실패 시.
    """
    # Gemini Batch API 호출 (SDK 버전에 따라 조정 필요)
    batch = _client.batches.create(
        model=EMBEDDING_MODEL,
        src=str(input_path),
        config=types.CreateBatchJobConfig(
            display_name=input_path.stem,
        ),
    )
    logger.info("Batch job submitted: %s", batch.name)
    return batch.name


def check_batch_status(batch_id: str) -> dict:
    """배치 작업 상태 확인.

    Returns:
        {"status": "pending"|"processing"|"completed"|"failed",
         "error": str|None}
    """
    batch = _client.batches.get(name=batch_id)
    state = batch.state.value if batch.state else "unknown"

    status_map = {
        "JOB_STATE_PENDING": "pending",
        "JOB_STATE_RUNNING": "processing",
        "JOB_STATE_SUCCEEDED": "completed",
        "JOB_STATE_FAILED": "failed",
        "JOB_STATE_CANCELLED": "failed",
    }

    return {
        "status": status_map.get(state, "pending"),
        "error": str(batch.error) if hasattr(batch, "error") and batch.error else None,
        "output_uri": getattr(batch, "dest", None),
    }


def download_batch_results(batch_id: str) -> list[list[float]]:
    """완료된 배치 작업의 임베딩 결과를 다운로드.

    Returns:
        임베딩 벡터 리스트 (각 1536차원).
    """
    batch = _client.batches.get(name=batch_id)
    embeddings = []

    # 결과 파일 파싱 (Gemini Batch API 응답 형식에 따라 조정)
    if hasattr(batch, "dest") and batch.dest:
        # 결과 파일에서 임베딩 추출
        for result in _client.batches.list_results(name=batch_id):
            if hasattr(result, "embeddings"):
                for emb in result.embeddings:
                    embeddings.append(list(emb.values))

    logger.info("Downloaded %d embeddings from batch %s", len(embeddings), batch_id)
    return embeddings
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/test_batch_embedder.py -v`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/src/pipeline/batch_embedder.py backend/tests/test_batch_embedder.py
git commit -m "feat: add batch embedder with Gemini Batch API wrapper"
```

---

### Task 4: Batch Service (오케스트레이션)

**Files:**
- Create: `backend/src/pipeline/batch_service.py`
- Create: `backend/tests/test_batch_service.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/test_batch_service.py
"""Batch Service 단위 테스트."""

from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import pytest

from src.pipeline.batch_models import BatchJob, BatchStatus
from src.pipeline.batch_service import BatchService


@pytest.fixture
def batch_repo():
    repo = AsyncMock()
    repo.create.side_effect = lambda job: job
    repo.commit = AsyncMock()
    return repo


@pytest.fixture
def service(batch_repo):
    return BatchService(repo=batch_repo)


@pytest.mark.asyncio
async def test_submit_creates_batch_job(service, batch_repo):
    """submit()이 BatchJob을 생성하고 DB에 저장."""
    chunks_texts = ["텍스트1", "텍스트2", "텍스트3"]

    with patch("src.pipeline.batch_service.prepare_batch_input") as mock_prep, \
         patch("src.pipeline.batch_service.submit_batch_job", return_value="batch-abc") as mock_submit:
        mock_prep.return_value = Path("/tmp/test.jsonl")

        job = await service.submit(
            chunks_texts=chunks_texts,
            filename="test.pdf",
            volume_key="test.pdf",
            source="L",
        )

    assert job.batch_id == "batch-abc"
    assert job.status == BatchStatus.PENDING
    assert job.total_chunks == 3
    assert job.filename == "test.pdf"
    batch_repo.create.assert_called_once()
    batch_repo.commit.assert_called_once()


@pytest.mark.asyncio
async def test_submit_failure_creates_failed_job(service, batch_repo):
    """Gemini API 제출 실패 시 status=failed로 저장."""
    with patch("src.pipeline.batch_service.prepare_batch_input") as mock_prep, \
         patch("src.pipeline.batch_service.submit_batch_job", side_effect=Exception("API error")):
        mock_prep.return_value = Path("/tmp/test.jsonl")

        job = await service.submit(
            chunks_texts=["텍스트"],
            filename="fail.pdf",
            volume_key="fail.pdf",
            source="L",
        )

    assert job.status == BatchStatus.FAILED
    assert "API error" in job.error_message
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/test_batch_service.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Batch Service 구현**

```python
# backend/src/pipeline/batch_service.py
"""Batch 임베딩 오케스트레이션 — 제출, 폴링, 적재."""

import logging
from pathlib import Path
from tempfile import mkdtemp

from src.pipeline.batch_embedder import (
    prepare_batch_input,
    submit_batch_job,
    check_batch_status,
    download_batch_results,
)
from src.pipeline.batch_models import BatchJob, BatchStatus
from src.pipeline.batch_repository import BatchJobRepository
from src.pipeline.embedder import embed_sparse_batch
from src.pipeline.ingestor import _build_points
from src.config import settings
from src.qdrant_client import get_client

logger = logging.getLogger(__name__)

# 배치 입력 JSONL 임시 저장 디렉토리
_BATCH_DIR = Path(mkdtemp(prefix="truewords_batch_"))


class BatchService:
    def __init__(self, repo: BatchJobRepository) -> None:
        self.repo = repo

    async def submit(
        self,
        chunks_texts: list[str],
        filename: str,
        volume_key: str,
        source: str,
    ) -> BatchJob:
        """배치 임베딩 작업 제출.

        청크 텍스트를 JSONL로 변환 → Gemini Batch API 제출 → BatchJob DB 저장.
        """
        job = BatchJob(
            batch_id="",
            filename=filename,
            volume_key=volume_key,
            source=source,
            total_chunks=len(chunks_texts),
        )

        try:
            # JSONL 생성
            jsonl_path = _BATCH_DIR / f"{volume_key}.jsonl"
            prepare_batch_input(chunks_texts, jsonl_path)

            # Gemini Batch API 제출
            batch_id = submit_batch_job(jsonl_path)
            job.batch_id = batch_id
            job.status = BatchStatus.PENDING

        except Exception as e:
            logger.exception("Batch 제출 실패: %s", filename)
            job.batch_id = f"failed-{volume_key}"
            job.status = BatchStatus.FAILED
            job.error_message = str(e)

        await self.repo.create(job)
        await self.repo.commit()
        return job

    async def poll_and_process(self) -> int:
        """pending/processing 상태 작업을 폴링하여 완료 시 Qdrant 적재.

        Returns:
            처리 완료된 작업 수.
        """
        jobs = await self.repo.list_by_status(
            BatchStatus.PENDING, BatchStatus.PROCESSING
        )
        completed_count = 0

        for job in jobs:
            try:
                result = check_batch_status(job.batch_id)
                status = result["status"]

                if status == "completed":
                    # 임베딩 결과 다운로드 + Qdrant 적재
                    await self._ingest_batch_results(job)
                    await self.repo.update_status(job, BatchStatus.COMPLETED)
                    completed_count += 1
                    logger.info("Batch 완료: %s (%d청크)", job.filename, job.total_chunks)

                elif status == "failed":
                    error = result.get("error", "Unknown error")
                    await self.repo.update_status(job, BatchStatus.FAILED, error)
                    logger.warning("Batch 실패: %s — %s", job.filename, error)

                elif status == "processing" and job.status == BatchStatus.PENDING:
                    await self.repo.update_status(job, BatchStatus.PROCESSING)

            except Exception as e:
                logger.exception("Batch 폴링 오류: %s", job.filename)
                await self.repo.update_status(
                    job, BatchStatus.FAILED, f"폴링 오류: {e}"
                )

        if completed_count > 0 or jobs:
            await self.repo.commit()

        return completed_count

    async def _ingest_batch_results(self, job: BatchJob) -> None:
        """완료된 배치의 임베딩을 다운로드하여 Qdrant에 적재."""
        dense_embeddings = download_batch_results(job.batch_id)

        if len(dense_embeddings) != job.total_chunks:
            logger.warning(
                "임베딩 수 불일치: expected=%d, got=%d",
                job.total_chunks, len(dense_embeddings),
            )

        # 원본 텍스트를 JSONL에서 복원
        jsonl_path = _BATCH_DIR / f"{job.volume_key}.jsonl"
        texts = []
        if jsonl_path.exists():
            import json
            with open(jsonl_path, encoding="utf-8") as f:
                for line in f:
                    data = json.loads(line)
                    texts.append(data["contents"])

        # Sparse 임베딩 생성 (로컬 CPU)
        sparse_embeddings = embed_sparse_batch(texts) if texts else []

        # Qdrant 적재
        client = get_client()
        from src.pipeline.ingestor import _build_and_upsert_points
        _build_and_upsert_points(
            client=client,
            collection_name=settings.collection_name,
            texts=texts,
            dense_embeddings=dense_embeddings,
            sparse_embeddings=sparse_embeddings,
            volume=job.volume_key,
            source=job.source,
            start_index=0,
        )

        # JSONL 임시 파일 삭제
        if jsonl_path.exists():
            jsonl_path.unlink()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/test_batch_service.py -v`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/src/pipeline/batch_service.py backend/tests/test_batch_service.py
git commit -m "feat: add batch service for embedding orchestration"
```

---

### Task 5: Admin 설정 API + Upload mode 파라미터

**Files:**
- Modify: `backend/src/admin/router.py:114`
- Modify: `backend/src/admin/data_router.py:91-152`

- [ ] **Step 1: GET /admin/settings/config 추가**

`backend/src/admin/router.py` 끝에 추가:

```python
@router.get("/settings/config")
async def get_settings_config(
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """프론트엔드에 필요한 시스템 설정 조회."""
    return {"gemini_tier": settings.gemini_tier}
```

- [ ] **Step 2: upload 엔드포인트에 mode 파라미터 추가**

`backend/src/admin/data_router.py`의 `upload_document` 함수 시그니처에 `mode` 파라미터 추가:

```python
@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source: str = Form("", description="데이터 소스 카테고리 key"),
    mode: str = Form("standard", description="처리 모드: standard | batch"),
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
):
```

함수 본문에서 mode 검증 추가 (source 검증 아래):

```python
    # mode 검증
    if mode not in ("standard", "batch"):
        raise HTTPException(status_code=400, detail="mode는 standard 또는 batch만 가능합니다")
    if mode == "batch" and settings.gemini_tier != "paid":
        raise HTTPException(status_code=400, detail="배치 처리는 유료 티어에서만 사용 가능합니다")
```

background_tasks 등록 부분에서 mode를 전달:

```python
    background_tasks.add_task(_process_file, tmp_path, safe_filename, source, mode)
```

- [ ] **Step 3: _process_file에 mode 분기 추가**

`_process_file` 시그니처에 `mode` 파라미터 추가:

```python
def _process_file(file_path: Path, filename: str, source: str, mode: str = "standard"):
```

Step 5 (Qdrant 적재) 직전에 mode 분기:

```python
        # 5. 임베딩 + 적재 (모드별 분기)
        if mode == "batch":
            # 배치 모드: 청크 텍스트만 추출하여 Batch API 제출
            import asyncio
            from src.common.database import get_async_session
            from src.pipeline.batch_repository import BatchJobRepository
            from src.pipeline.batch_service import BatchService

            chunk_texts = [c.text for c in chunks]

            async def _submit_batch():
                async with get_async_session() as session:
                    repo = BatchJobRepository(session)
                    svc = BatchService(repo=repo)
                    await svc.submit(
                        chunks_texts=chunk_texts,
                        filename=filename,
                        volume_key=volume_key,
                        source=source,
                    )

            asyncio.run(_submit_batch())
            logger.info("[%s] 배치 작업 제출 완료 (%d청크)", volume_key, len(chunks))
        else:
            # 즉시 모드: 기존 로직
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
            tracker.mark_completed(volume_key, stats["chunk_count"])
```

- [ ] **Step 4: batch-jobs 엔드포인트 추가**

`backend/src/admin/data_router.py` 끝에 추가:

```python
@router.get("/batch-jobs")
async def list_batch_jobs(
    current_admin: dict = Depends(get_current_admin),
):
    """배치 작업 목록 조회."""
    from src.common.database import get_async_session
    from src.pipeline.batch_repository import BatchJobRepository

    async with get_async_session() as session:
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
```

- [ ] **Step 5: 커밋**

```bash
git add backend/src/admin/router.py backend/src/admin/data_router.py
git commit -m "feat: add settings config API and batch mode to upload endpoint"
```

---

### Task 6: Admin UI — 모드 선택 + 배치 상태

**Files:**
- Modify: `admin/src/app/(dashboard)/data-sources/page.tsx`

- [ ] **Step 1: gemini_tier 조회 훅 추가**

파일 상단에 tier 조회 추가:

```typescript
const { data: configData } = useQuery({
  queryKey: ["admin-config"],
  queryFn: () => fetchAPI<{ gemini_tier: string }>("/admin/settings/config"),
});
const isPaidTier = configData?.gemini_tier === "paid";
```

- [ ] **Step 2: 업로드 폼에 모드 선택 라디오 추가**

업로드 폼의 소스 선택 아래에:

```tsx
{/* 처리 모드 */}
<div className="space-y-2">
  <Label className="text-sm font-medium">처리 방식</Label>
  <div className="flex gap-4">
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="radio"
        name="mode"
        value="standard"
        checked={mode === "standard"}
        onChange={() => setMode("standard")}
        className="accent-primary"
      />
      <span className="text-sm">즉시 처리</span>
    </label>
    <label className={`flex items-center gap-2 ${isPaidTier ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
      <input
        type="radio"
        name="mode"
        value="batch"
        checked={mode === "batch"}
        onChange={() => setMode("batch")}
        disabled={!isPaidTier}
        className="accent-primary"
      />
      <span className="text-sm">배치 처리 (50% 할인)</span>
      {!isPaidTier && (
        <Badge variant="outline" className="text-xs">유료 전용</Badge>
      )}
    </label>
  </div>
</div>
```

state 추가: `const [mode, setMode] = useState<"standard" | "batch">("standard");`

업로드 FormData에 mode 추가: `formData.append("mode", mode);`

- [ ] **Step 3: 배치 작업 상태 섹션 추가**

업로드 상태 영역 아래에:

```tsx
{/* 배치 작업 */}
<BatchJobList />
```

BatchJobList 컴포넌트:

```tsx
function BatchJobList() {
  const { data: jobs = [] } = useQuery({
    queryKey: ["batch-jobs"],
    queryFn: () => fetchAPI<BatchJobItem[]>("/admin/data-sources/batch-jobs"),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const hasActive = data.some(
        (j: BatchJobItem) => j.status === "pending" || j.status === "processing"
      );
      return hasActive ? 10000 : false;
    },
  });

  if (jobs.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">배치 작업</h3>
      <div className="space-y-2">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
            <span className="truncate max-w-[200px]">{job.filename}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{job.total_chunks} 청크</span>
              <Badge variant={
                job.status === "completed" ? "default" :
                job.status === "failed" ? "destructive" : "secondary"
              }>
                {job.status === "pending" ? "대기 중" :
                 job.status === "processing" ? "처리 중" :
                 job.status === "completed" ? "완료" : "실패"}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BatchJobItem {
  id: string;
  filename: string;
  total_chunks: number;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}
```

- [ ] **Step 4: 커밋**

```bash
git add admin/src/app/\(dashboard\)/data-sources/page.tsx
git commit -m "feat: add batch mode selector and batch job status to upload UI"
```

---

### Task 7: 전체 테스트 검증 + TODO.md

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: Backend 테스트 실행**

Run: `source backend/.venv/bin/activate && cd backend && python -m pytest tests/ -x -q`
Expected: All passed

- [ ] **Step 2: Admin 테스트 실행**

Run: `cd admin && npx vitest run`
Expected: All passed

- [ ] **Step 3: TODO.md 업데이트**

Next Actions의 임베딩 Batch API 항목을 완료로 변경.

- [ ] **Step 4: 커밋**

```bash
git add docs/TODO.md
git commit -m "docs: update TODO.md with embedding batch API completion"
```
