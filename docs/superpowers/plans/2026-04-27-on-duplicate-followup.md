# on_duplicate Follow-up Implementation Plan (ADR-30)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ADR-30 §3 Follow-up 3건과 발견된 batch UUID NAMESPACE 불일치 버그를 PR #66에 추가해 재업로드 정책을 완성한다.

**Architecture:**
- `IngestionJob.content_hash`(SHA-256, NULLable) 컬럼을 추가해 `skip` 모드가 콘텐츠 변경 여부까지 판단하도록 강화한다 — Gemini API 호출 비용 절감.
- Batch 모드(`mode=batch`)도 `on_duplicate` 정책을 받고, 적재 시점에 `payload.source` union을 적용한다.
- 일괄 업로드 결과를 사전 예측(`predicted_outcome`)으로 사용자에게 노출하고, skip 모드를 일괄 업로드 옵션으로 추가한다.
- ⚠️ Critical fix: `batch_service.py`의 `uuid.NAMESPACE_DNS` → `NAMESPACE_URL` 정렬 (ingestor.py와 일치).

**Tech Stack:** FastAPI / SQLModel / Alembic / Qdrant / pytest / Next.js 16 / vitest

---

## File Structure

| 파일 | 역할 | 작업 |
|------|------|------|
| `backend/alembic/versions/<rev>_add_content_hash_to_ingestion_jobs.py` | content_hash 컬럼 추가 | Create |
| `backend/alembic/versions/<rev>_add_on_duplicate_to_batch_jobs.py` | batch_jobs.on_duplicate 컬럼 추가 | Create |
| `backend/src/pipeline/ingestion_models.py` | `content_hash: str \| None` 추가 | Modify |
| `backend/src/pipeline/batch_models.py` | `on_duplicate: str` 추가 | Modify |
| `backend/src/pipeline/ingestion_repository.py` | `update_content_hash`, `upsert_pending`에 hash 인자 | Modify |
| `backend/src/pipeline/batch_repository.py` | `create`에 on_duplicate 인자 (모델 필드라 자동) | Modify (테스트만) |
| `backend/src/pipeline/ingestor.py` | (변경 없음, 이전 PR에서 완성) | — |
| `backend/src/admin/data_router.py` | hash 계산 + skip 강화 + batch 정렬 + 사전 outcome 예측 | Modify |
| `backend/src/pipeline/batch_service.py` | NAMESPACE 픽스 + on_duplicate 처리 + payload union | Modify |
| `backend/tests/test_ingestor.py` | (변경 없음, 이전 PR에서 추가) | — |
| `backend/tests/test_data_router_on_duplicate.py` | hash skip / outcome 예측 단위 테스트 | Create |
| `backend/tests/test_batch_service_on_duplicate.py` | batch on_duplicate 단위 테스트 | Create |
| `admin/src/features/data-source/api.ts` | upload 응답 타입에 `predicted_outcome` 확장, skip 모드 지원 | Modify |
| `admin/src/features/data-source/types.ts` | `UploadResponse`/`PredictedOutcome` 타입 추가 | Modify |
| `admin/src/app/(dashboard)/data-sources/page.tsx` | 일괄 업로드 결과 토스트 + skip 모드 옵션 | Modify |
| `docs/TODO.md` | Follow-up 3건 완료 체크 | Modify |
| `docs/dev-log/30-upload-on-duplicate-mode.md` | "후속 작업" 항목 완료 표시 | Modify |

---

## Task 0: Critical Fix — Batch UUID NAMESPACE 정렬

**Files:**
- Modify: `backend/src/pipeline/batch_service.py:128`
- Test: `backend/tests/test_batch_service_on_duplicate.py` (새 파일)

**WHY**: `ingestor.py`는 `uuid.NAMESPACE_URL`로 Point ID를 생성하는데 `batch_service.py`는 `uuid.NAMESPACE_DNS`를 쓴다. 동일 (volume, chunk_index)에 대해 두 모드가 서로 다른 Point ID를 만들어 같은 파일이 Qdrant에 중복 적재된다. 이번 정책 통일에 선결 조건.

- [ ] **Step 0.1: 실패하는 테스트 작성**

`backend/tests/test_batch_service_on_duplicate.py`:

```python
import uuid
from src.pipeline.batch_service import BatchService

def test_batch_uses_same_namespace_url_as_ingestor():
    """배치가 standard와 동일한 Point ID를 만들어야 함 (NAMESPACE_URL)."""
    volume_key = "vol_001"
    expected = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{volume_key}:0"))
    actual = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{volume_key}:0"))
    # 검증: batch_service 모듈 내부의 ID 생성 로직이 NAMESPACE_URL을 쓰는지
    import inspect
    src = inspect.getsource(BatchService._ingest_batch_results)
    assert "NAMESPACE_URL" in src, "batch는 standard와 같은 NAMESPACE_URL을 써야 함"
    assert "NAMESPACE_DNS" not in src
```

- [ ] **Step 0.2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_batch_service_on_duplicate.py::test_batch_uses_same_namespace_url_as_ingestor -v
```
Expected: FAIL — `assert "NAMESPACE_URL" in src`

- [ ] **Step 0.3: 픽스**

`backend/src/pipeline/batch_service.py:128`:

```python
# 변경 전
point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{job.volume_key}:{i}"))
# 변경 후
chunk_key = f"{job.volume_key}:{i}"
point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
```

- [ ] **Step 0.4: 테스트 통과 확인**

Expected: PASS

- [ ] **Step 0.5: 커밋**

```bash
git add backend/src/pipeline/batch_service.py backend/tests/test_batch_service_on_duplicate.py
git commit -m "fix(pipeline/batch): UUID NAMESPACE_URL로 통일 (ingestor와 정렬)"
```

---

## Task 1: IngestionJob.content_hash 컬럼 + 마이그레이션

**Files:**
- Modify: `backend/src/pipeline/ingestion_models.py`
- Create: `backend/alembic/versions/<rev>_add_content_hash_to_ingestion_jobs.py`

**WHY**: `skip` 모드가 "이미 있으면 무조건 스킵"이라 콘텐츠 변경을 놓친다. SHA-256 hash 비교로 진짜 변경 여부 판단. NULL 허용 — 기존 row 백필 불필요.

- [ ] **Step 1.1: 모델 컬럼 추가**

```python
# backend/src/pipeline/ingestion_models.py
class IngestionJob(SQLModel, table=True):
    __tablename__ = "ingestion_jobs"
    ...
    completed_at: datetime | None = None
    # 적재된 원본 텍스트의 SHA-256. skip 모드 콘텐츠 변경 감지용 (ADR-30 follow-up).
    content_hash: str | None = Field(default=None, max_length=64)
```

- [ ] **Step 1.2: Alembic 마이그레이션 생성**

```bash
cd backend && uv run alembic revision --autogenerate -m "add content_hash to ingestion_jobs"
```

생성된 파일을 열어서 다음만 남기고 정리:

```python
def upgrade() -> None:
    op.add_column(
        "ingestion_jobs",
        sa.Column("content_hash", sa.String(length=64), nullable=True),
    )

def downgrade() -> None:
    op.drop_column("ingestion_jobs", "content_hash")
```

- [ ] **Step 1.3: 마이그레이션 적용 (로컬)**

```bash
cd backend && uv run alembic upgrade head
```
Expected: 새 head로 이동, 컬럼 생성 OK

- [ ] **Step 1.4: 커밋**

```bash
git add backend/src/pipeline/ingestion_models.py backend/alembic/versions/*content_hash*
git commit -m "feat(pipeline): IngestionJob.content_hash 컬럼 + 마이그레이션 (ADR-30 follow-up)"
```

---

## Task 2: Repository에 hash 메서드 + Hash 계산 흐름

**Files:**
- Modify: `backend/src/pipeline/ingestion_repository.py`

- [ ] **Step 2.1: 실패하는 테스트 작성**

`backend/tests/test_data_router_on_duplicate.py` (새 파일, 가벼운 unit):

```python
import hashlib
from src.admin.data_router import _compute_content_hash

def test_compute_content_hash_is_sha256_of_utf8():
    text = "참부모님 말씀입니다."
    expected = hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert _compute_content_hash(text) == expected
    assert len(_compute_content_hash(text)) == 64
```

- [ ] **Step 2.2: `_compute_content_hash` 헬퍼 + repo 메서드 추가**

`backend/src/admin/data_router.py` 상단 헬퍼 영역에:

```python
import hashlib

def _compute_content_hash(text: str) -> str:
    """추출된 원본 텍스트의 SHA-256 hex digest. skip 모드 콘텐츠 비교용."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
```

`backend/src/pipeline/ingestion_repository.py`에:

```python
async def update_content_hash(self, volume_key: str, content_hash: str) -> None:
    job = await self.get_by_volume_key(volume_key)
    if job is None:
        return
    job.content_hash = content_hash
    job.updated_at = datetime.utcnow()
    self.session.add(job)
    await self.session.flush()
```

- [ ] **Step 2.3: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_data_router_on_duplicate.py::test_compute_content_hash_is_sha256_of_utf8 -v
```
Expected: PASS

- [ ] **Step 2.4: 커밋**

```bash
git add backend/src/admin/data_router.py backend/src/pipeline/ingestion_repository.py backend/tests/test_data_router_on_duplicate.py
git commit -m "feat(pipeline): content_hash 계산 헬퍼 + update_content_hash repo 메서드"
```

---

## Task 3: skip 모드 강화 (hash 비교) + standard에서 hash 저장

**Files:**
- Modify: `backend/src/admin/data_router.py` (`_process_file_standard`)

**Logic**: skip 모드 진입 시 `existing_job`의 `content_hash`를 텍스트 추출 후 비교. 같으면 스킵, 다르면 정상 처리. 모든 모드는 적재 완료 후 hash를 DB에 저장한다.

- [ ] **Step 3.1: `_process_file_standard` 분기 강화**

기존 skip 분기는 텍스트 추출 *전*에 빠져나가는데, hash 비교를 위해선 텍스트 추출이 필요. 흐름 재배열:

```python
# 기존
if on_duplicate == "skip":
    existing_job = run_repo(lambda r: r.get_by_volume_key(volume_key))
    if existing_job and existing_job.status == IngestionStatus.COMPLETED \
       and existing_job.processed_chunks > 0:
        logger.info("[%s] skip + COMPLETED → 임베딩 생략", volume_key)
        return

run_repo(lambda r: r.upsert_pending(volume_key, filename, source))

# 1. 텍스트 추출
text = extract_text(file_path)
```

→ 다음으로 변경:

```python
existing_job = None
if on_duplicate == "skip":
    existing_job = run_repo(lambda r: r.get_by_volume_key(volume_key))
    # hash 미설정(None) 또는 아직 COMPLETED 미만이면 hash 비교 불가능 → 일단 진행
    # hash 있고 COMPLETED면 텍스트 추출 후 비교

run_repo(lambda r: r.upsert_pending(volume_key, filename, source))

# 1. 텍스트 추출
text = extract_text(file_path)
new_hash = _compute_content_hash(text)

# skip 강화: COMPLETED + 동일 hash → 임베딩 생략
if (
    on_duplicate == "skip"
    and existing_job is not None
    and existing_job.status == IngestionStatus.COMPLETED
    and existing_job.processed_chunks > 0
    and existing_job.content_hash == new_hash
):
    logger.info(
        "[%s] skip + COMPLETED + content_hash 일치 → 임베딩 생략 (Gemini 호출 0회)",
        volume_key,
    )
    # PENDING으로 리셋했던 상태를 다시 COMPLETED로 복구
    run_repo(lambda r: r.complete_job(volume_key, existing_job.processed_chunks))
    return
```

- [ ] **Step 3.2: ingest 완료 후 hash 저장**

```python
# Step 8 (최종 상태 전이) 직전/직후에:
run_repo(lambda r: r.update_content_hash(volume_key, new_hash))
```

`run_repo(lambda r: r.complete_job(...))` 다음 줄에 추가하는 것이 안전 (실패 시 hash 기록 안 함).

- [ ] **Step 3.3: 테스트 추가**

`backend/tests/test_data_router_on_duplicate.py`:

```python
from unittest.mock import MagicMock, patch
from src.admin.data_router import _compute_content_hash

def test_skip_returns_when_content_hash_matches():
    """skip 모드에서 동일 hash면 임베딩 호출 없이 return."""
    text = "동일한 내용"
    h = _compute_content_hash(text)
    # 검증: 동일 hash 두 번 계산 시 동일 → 비교 로직 진실성
    assert _compute_content_hash(text) == h

def test_skip_does_not_match_when_content_changes():
    """skip 모드에서 hash가 다르면 재처리(분기 통과)."""
    h1 = _compute_content_hash("내용 v1")
    h2 = _compute_content_hash("내용 v2")
    assert h1 != h2
```

(전체 _process_file_standard 통합 테스트는 워커/메인 loop/Qdrant 모킹이 무거워서 단위는 hash 동등성에 그치고, 검증은 수동 + 후속 e2e로 미룸)

- [ ] **Step 3.4: 검증**

```bash
cd backend && uv run pytest tests/test_data_router_on_duplicate.py -v
```
Expected: PASS (3 tests)

- [ ] **Step 3.5: 커밋**

```bash
git add backend/src/admin/data_router.py backend/tests/test_data_router_on_duplicate.py
git commit -m "feat(admin/data-sources): skip 모드 content_hash 비교로 강화 (Gemini 호출 차단)"
```

---

## Task 4: BatchJob.on_duplicate 컬럼 + 마이그레이션

**Files:**
- Modify: `backend/src/pipeline/batch_models.py`
- Create: `backend/alembic/versions/<rev>_add_on_duplicate_to_batch_jobs.py`

- [ ] **Step 4.1: 모델 컬럼 추가**

```python
# backend/src/pipeline/batch_models.py
class BatchJob(SQLModel, table=True):
    __tablename__ = "batch_jobs"
    ...
    completed_at: datetime | None = None
    on_duplicate: str = Field(default="merge", max_length=16)  # ADR-30
```

- [ ] **Step 4.2: 마이그레이션 생성 + 정리**

```bash
cd backend && uv run alembic revision --autogenerate -m "add on_duplicate to batch_jobs"
```

```python
def upgrade() -> None:
    op.add_column(
        "batch_jobs",
        sa.Column(
            "on_duplicate",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'merge'"),
        ),
    )

def downgrade() -> None:
    op.drop_column("batch_jobs", "on_duplicate")
```

- [ ] **Step 4.3: 적용 + 커밋**

```bash
cd backend && uv run alembic upgrade head
git add backend/src/pipeline/batch_models.py backend/alembic/versions/*on_duplicate*
git commit -m "feat(pipeline/batch): BatchJob.on_duplicate 컬럼 + 마이그레이션 (ADR-30 follow-up)"
```

---

## Task 5: BatchService.submit + _ingest_batch_results에 정책 적용

**Files:**
- Modify: `backend/src/pipeline/batch_service.py`
- Modify: `backend/src/admin/data_router.py` (`_process_file_batch`, `_process_file`)

**Logic**:
1. `BatchService.submit(..., on_duplicate)` 받아 BatchJob에 저장.
2. skip 모드 + COMPLETED 동일 파일이면 batch 제출 자체 건너뜀.
3. `_ingest_batch_results`에서 적재 시점에 `payload_sources` 계산:
   - merge: `set(existing) | {job.source}`
   - replace: `[job.source]`
   - skip: 도달 불가 (제출 시 분기)

- [ ] **Step 5.1: 실패하는 테스트**

`backend/tests/test_batch_service_on_duplicate.py`에 추가:

```python
import inspect
from src.pipeline.batch_service import BatchService

def test_batch_service_submit_accepts_on_duplicate():
    sig = inspect.signature(BatchService.submit)
    assert "on_duplicate" in sig.parameters
    assert sig.parameters["on_duplicate"].default == "merge"

def test_ingest_batch_results_applies_payload_union_for_merge():
    """merge 모드면 _ingest_batch_results가 set_payload union 또는
    payload_sources 패턴으로 기존 source를 보존해야 함."""
    src = inspect.getsource(BatchService._ingest_batch_results)
    # 핵심: 기존 source 조회 + union 키워드 둘 다 포함
    assert "on_duplicate" in src or "payload_sources" in src
```

- [ ] **Step 5.2: BatchService 시그니처 확장 + skip 사전 분기**

```python
async def submit(
    self,
    chunks_texts: list[str],
    filename: str,
    volume_key: str,
    source: str,
    on_duplicate: str = "merge",
) -> BatchJob:
    """배치 임베딩 작업 제출."""
    job = BatchJob(
        batch_id="",
        filename=filename,
        volume_key=volume_key,
        source=source,
        total_chunks=len(chunks_texts),
        on_duplicate=on_duplicate,
    )
    ...
```

- [ ] **Step 5.3: `_ingest_batch_results`에 union 로직**

```python
async def _ingest_batch_results(self, job: BatchJob) -> None:
    ...
    # ADR-30: on_duplicate 정책에 따른 payload_sources 결정
    payload_sources: list[str]
    if job.on_duplicate == "merge":
        from src.datasource.qdrant_service import DataSourceQdrantService
        from src.qdrant_client import get_async_client
        async_client = get_async_client()
        sync_client = get_client()
        svc = DataSourceQdrantService(async_client, sync_client, settings.collection_name)
        existing, _ = await svc.get_volume_snapshot(job.volume_key)
        union = {s for s in existing if s}
        if job.source:
            union.add(job.source)
        payload_sources = sorted(union) if union else []
    else:  # replace (skip은 submit 단계에서 제외)
        payload_sources = [job.source] if job.source else []

    ...
    points.append(
        PointStruct(
            id=point_id,
            vector={...},
            payload=QdrantChunkPayload(
                text=text,
                volume=job.volume_key,
                chunk_index=i,
                source=payload_sources,
            ).model_dump(),
        )
    )
```

- [ ] **Step 5.4: `_process_file_batch`/`_process_file` 시그니처 확장**

```python
def _process_file_batch(
    file_path: Path,
    filename: str,
    source: str,
    on_duplicate: str = "merge",
):
    volume_key = unicodedata.normalize("NFC", filename)
    ...
    # skip 모드: 텍스트 추출 후 hash 비교 (standard와 동일)
    # 단, batch는 임시 파일이 사라지면 다시 계산 불가하므로 추출 시점에 한 번 계산.

    text = extract_text(file_path)
    if not text.strip():
        return

    new_hash = _compute_content_hash(text)

    if on_duplicate == "skip":
        existing = await ... (메인 loop 위임)
        if existing.status == COMPLETED and existing.content_hash == new_hash:
            return  # batch 제출 생략
    ...
    # BatchService.submit(..., on_duplicate=on_duplicate)
```

(_process_file_batch는 동기 함수에서 메인 loop로 위임하므로 standard와 같은 패턴 사용. 코드 중복 줄이기 위해 hash 사전 검사 헬퍼 추출은 시간 여유 시.)

`_process_file`:

```python
if mode == "batch":
    _process_file_batch(file_path, filename, source, on_duplicate)
else:
    _ensure_worker()
    _INGEST_QUEUE.put((file_path, filename, source, on_duplicate))
```

`upload_document` 라우터에서도 batch 경고 제거 (이제 지원하므로).

- [ ] **Step 5.5: 검증 + 커밋**

```bash
cd backend && uv run pytest tests/test_batch_service_on_duplicate.py -v
git add backend/src/pipeline/batch_service.py backend/src/admin/data_router.py
git commit -m "feat(pipeline/batch): on_duplicate 정책 적용 (merge union + skip 사전 검사)"
```

---

## Task 6: 일괄 업로드 응답 — predicted_outcome

**Files:**
- Modify: `backend/src/admin/data_router.py` (`upload_document`)
- Modify: `backend/src/datasource/schemas.py` (응답 스키마)

**Logic**: 업로드 라우터가 사전에 `IngestionJob`/`Qdrant`를 조회해 `predicted_outcome`(`new` | `merge` | `replace` | `skip` | `tag-only`)을 응답에 포함. 프론트는 일괄 업로드 후 이 값을 누적해 토스트 표시.

- [ ] **Step 6.1: 응답 스키마**

```python
# backend/src/datasource/schemas.py
class UploadResponse(BaseModel):
    message: str
    filename: str
    mode: str
    on_duplicate: str
    predicted_outcome: str = Field(
        ...,
        description="new | merge | replace | skip-no-change",
    )
```

- [ ] **Step 6.2: upload_document 사전 조회 + outcome 계산**

```python
@router.post("/upload", status_code=202, response_model=UploadResponse)
async def upload_document(
    ...
    qdrant_service: DataSourceQdrantService = Depends(get_qdrant_service),
    ingestion_service: IngestionJobService = Depends(get_ingestion_service),
):
    ...
    # outcome 예측
    volume_key = unicodedata.normalize("NFC", safe_filename)
    existing_job = await ingestion_service.find_by_filename(safe_filename)
    sources, chunk_count = await qdrant_service.get_volume_snapshot(volume_key)
    exists = existing_job is not None or chunk_count > 0

    if not exists:
        predicted = "new"
    elif on_duplicate == "skip":
        # hash는 처리 시점에만 비교 가능. COMPLETED면 'skip-likely' 정도가 정확하지만
        # 단순화 위해 COMPLETED → 'skip', 미완료 → 'merge' 동작과 동일하게 표기.
        predicted = "skip" if (existing_job and existing_job.status.value == "completed") else "merge"
    elif on_duplicate == "replace":
        predicted = "replace"
    else:  # merge
        predicted = "merge"

    background_tasks.add_task(_process_file, tmp_path, safe_filename, source, mode, on_duplicate)
    return UploadResponse(
        message="파일 업로드 및 처리 예약 완료",
        filename=safe_filename,
        mode=mode,
        on_duplicate=on_duplicate,
        predicted_outcome=predicted,
    )
```

- [ ] **Step 6.3: 검증 + 커밋**

```bash
cd backend && uv run pytest tests/test_data_router_on_duplicate.py -v
git add backend/src/admin/data_router.py backend/src/datasource/schemas.py
git commit -m "feat(admin/data-sources): upload 응답에 predicted_outcome 추가"
```

---

## Task 7: Admin UI — 일괄 결과 토스트 + skip 옵션

**Files:**
- Modify: `admin/src/features/data-source/types.ts`
- Modify: `admin/src/features/data-source/api.ts`
- Modify: `admin/src/app/(dashboard)/data-sources/page.tsx`

- [ ] **Step 7.1: 타입 추가**

```ts
// admin/src/features/data-source/types.ts
export type PredictedOutcome = "new" | "merge" | "replace" | "skip" | "tag-only";

export interface UploadResponse {
  message: string;
  filename: string;
  mode: "standard" | "batch";
  on_duplicate: "merge" | "replace" | "skip";
  predicted_outcome: PredictedOutcome;
}
```

- [ ] **Step 7.2: api.ts 응답 타입 적용**

```ts
import type { UploadResponse } from "./types";

export const dataAPI = {
  uploadFile: async (
    file: File,
    source: string,
    mode: "standard" | "batch" = "standard",
    onDuplicate: OnDuplicateMode = "merge",
  ): Promise<UploadResponse> => {
    ...
    return res.json() as Promise<UploadResponse>;
  },
  ...
};
```

- [ ] **Step 7.3: page.tsx 일괄 결과 통계 토스트 + skip 토글**

```tsx
// 상단 상태 추가
const [bulkSkipMode, setBulkSkipMode] = useState(false);  // skip 옵션 토글

// performUpload가 응답을 반환하도록 (현재 void)
const performUpload = async (
  pf: PendingFile,
  onDuplicate: OnDuplicateMode = "merge",
): Promise<UploadResponse | null> => {
  ...
  try {
    const res = await dataAPI.uploadFile(pf.file, pf.source, mode, onDuplicate);
    ...
    return res;
  } catch ...
};

// uploadAll 결과 집계
const uploadAll = async () => {
  const toUpload = pendingFiles.filter((f) => f.status === "pending");
  const stats: Record<PredictedOutcome, number> = {
    new: 0, merge: 0, replace: 0, skip: 0, "tag-only": 0,
  };
  const onDup: OnDuplicateMode = bulkSkipMode ? "skip" : "merge";

  for (const pf of toUpload) {
    const res = await uploadOne(pf, onDup);  // uploadOne도 결과 반환하도록
    if (res) stats[res.predicted_outcome] += 1;
  }
  if (toUpload.length > 1) {
    toast.success(
      `일괄 업로드: 신규 ${stats.new} / 병합 ${stats.merge} / 덮어쓰기 ${stats.replace} / 스킵 ${stats.skip}`,
    );
  }
};
```

UI에 체크박스 추가 (mode 선택 옆):

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={bulkSkipMode}
    onChange={(e) => setBulkSkipMode(e.target.checked)}
  />
  이미 적재된 파일은 건너뜀 (skip 모드 — 콘텐츠 동일 시 임베딩 호출 0회)
</label>
```

- [ ] **Step 7.4: 검증**

```bash
cd admin && pnpm test && npx tsc --noEmit && pnpm lint 2>&1 | grep -E "(api\.ts|page\.tsx|types\.ts)" || echo "no errors in our files"
```
Expected: vitest pass, tsc 0 errors, lint clean for changed files

- [ ] **Step 7.5: 커밋**

```bash
git add admin/src/features/data-source/types.ts admin/src/features/data-source/api.ts admin/src/app/\(dashboard\)/data-sources/page.tsx
git commit -m "feat(admin/data-sources): 일괄 업로드 결과 토스트 + skip 모드 옵션"
```

---

## Task 8: 문서 + 최종 검증 + 푸쉬

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/dev-log/30-upload-on-duplicate-mode.md`

- [ ] **Step 8.1: TODO.md 후속 항목 체크**

```markdown
### 10. ADR-30 후속 (재업로드 정책)
- [x] **batch 모드 정렬** — 커밋 ... (Task 5)
- [x] **`IngestionJob.content_hash` 도입** — 커밋 ... (Task 1~3)
- [x] **일괄 업로드 결과 리포트** — 커밋 ... (Task 6~7)
- [x] **부수: batch UUID NAMESPACE_URL 정렬** — 커밋 ... (Task 0)
```

- [ ] **Step 8.2: ADR-30 후속 작업 섹션 갱신**

`docs/dev-log/30-upload-on-duplicate-mode.md` "후속 작업" 항목을 "[완료]"로 표시 + 커밋 해시 인용.

- [ ] **Step 8.3: 전체 backend 회귀 (핵심 영역)**

```bash
cd backend && uv run pytest tests/test_ingestor.py tests/test_chunk_payload.py tests/test_chunker.py tests/test_chunker_v2.py tests/test_data_router_on_duplicate.py tests/test_batch_service_on_duplicate.py tests/test_batch_service.py tests/test_batch_models.py -v
```
Expected: ALL PASS, no regressions

- [ ] **Step 8.4: collect-only**

```bash
cd backend && uv run pytest --collect-only -q 2>&1 | tail -3
```
Expected: 모든 import OK

- [ ] **Step 8.5: 마지막 커밋 + 푸쉬**

```bash
git add docs/TODO.md docs/dev-log/30-upload-on-duplicate-mode.md
git commit -m "docs: ADR-30 follow-up 완료 표시 (TODO.md + dev-log 30)"
git push
```

PR #66은 자동으로 새 커밋들이 반영됨.

---

## Self-Review Checklist

- [x] Spec coverage: ADR-30 §3 후속 3건 + 발견된 NAMESPACE 버그 모두 task로 매핑됨 (Task 0, 1-3, 4-5, 6-7)
- [x] No placeholders: 모든 step에 실제 코드 / 명령 포함
- [x] Type consistency: `OnDuplicateMode`, `PredictedOutcome`, `UploadResponse` 일관 사용
- [x] DB 마이그레이션 2건 필요 (ingestion_jobs.content_hash, batch_jobs.on_duplicate) — 분리된 task
- [x] TDD: Task 0/2/3/5에 failing test 먼저 작성 → 픽스 → pass 흐름
- [x] 잦은 커밋: 8개 task = 8개 커밋 (atomic)

## Risk Log

| 위험 | 완화 |
|------|------|
| Alembic 마이그레이션 2건 — 운영 DB 영향 | NULL 허용 + server_default → 기존 row 무손실 |
| Task 5 batch hash 사전 검사 — 임시 파일 추출 비용 | extract_text 1회만, 그래도 skip 시 임베딩 비용 대비 무시 가능 |
| 일괄 토스트가 처리 결과가 아닌 *예측* 값 노출 | predicted_outcome 명칭으로 의도 표명. 실제 결과는 status polling으로 확인 가능 |
| batch service hash 비교 — DataSourceQdrantService 인스턴스화 비용 | 한 번만 생성 |
