# Embedding Batch API 설계

> **날짜:** 2026-04-11
> **목표:** Gemini Batch API를 활용하여 대량 임베딩 비용을 50% 절감하면서, 급한 건은 즉시 처리할 수 있는 듀얼 모드 제공
> **전제:** Gemini 유료 티어 전환 예정. Batch API는 유료 전용.

---

## 요구사항 요약

- **동기:** 비용 절감 (Standard $0.15/M → Batch $0.075/M, 50% 할인)
- **규모:** 중규모 (초기 615권 적재 + 월 수백 건 추가)
- **처리 모드:** 듀얼 — 관리자가 "즉시 처리" / "배치 처리" 선택
- **티어 제어:** Free tier에서는 배치 처리 비활성화 (UI + 백엔드 이중 방어)

---

## 아키텍처

### 전체 흐름

```
Admin UI 업로드 폼
  ├─ GEMINI_TIER=free  → [즉시 처리] 고정, [배치 처리] 비활성 + "유료 전용" 표시
  └─ GEMINI_TIER=paid  → [즉시 처리] / [배치 처리] 선택 가능

즉시 처리 (mode=standard):
  → 기존 _process_file() 그대로
  → embed_dense_batch() → Standard API → 즉시 Qdrant 적재

배치 처리 (mode=batch):
  → (1) 텍스트 추출 + 청킹 (기존 코드 재사용)
  → (2) 청크 텍스트를 임시 JSONL 파일로 저장
  → (3) Gemini Batch API 제출 → batch_id 수령
  → (4) BatchJob 레코드 DB 저장 (status=pending)
  → 202 응답 (즉시 반환)

백그라운드 폴링:
  → (5) pending/processing 상태 BatchJob 조회
  → (6) Gemini batch.get(batch_id)로 상태 확인
  → (7) 완료 시: 결과 다운로드 → Sparse 임베딩 로컬 생성 → Qdrant upsert → status=completed
  → (8) 실패 시: status=failed + error_message 기록
```

### 핵심 원칙

- **청킹까지는 공유:** 텍스트 추출 + 청킹은 모드 무관하게 동일 코드
- **임베딩만 분기:** Standard API vs Batch API
- **Sparse 임베딩은 항상 로컬:** BM25는 CPU로 즉시 처리, Batch 대상 아님
- **기존 코드 최소 변경:** `_process_file()`에 `mode` 파라미터 추가

---

## 데이터 모델

### BatchJob 테이블

```python
class BatchStatus(str, Enum):
    PENDING = "pending"        # Gemini에 제출됨, 대기 중
    PROCESSING = "processing"  # Gemini가 처리 중
    COMPLETED = "completed"    # 임베딩 완료, Qdrant 적재 완료
    FAILED = "failed"          # 실패

class BatchJob(SQLModel, table=True):
    __tablename__ = "batch_jobs"

    id: uuid.UUID              # PK
    batch_id: str              # Gemini Batch API 반환 ID
    filename: str              # 원본 파일명
    volume_key: str            # 문서 식별자
    source: str                # 카테고리 키 (L, M 등)
    total_chunks: int          # 전체 청크 수
    status: BatchStatus        # pending → processing → completed → failed
    error_message: str | None  # 실패 시 에러 내용
    created_at: datetime
    completed_at: datetime | None
```

**저장하지 않는 것:**
- 청크 텍스트 자체 (임시 JSONL 파일로 관리, 완료 후 삭제)
- 임베딩 벡터 (Gemini 결과에서 직접 Qdrant로)

---

## API 엔드포인트

### 신규

| Method | 경로 | 용도 |
|--------|------|------|
| GET | `/admin/settings/config` | `{ gemini_tier: "free" \| "paid" }` 조회 |
| GET | `/admin/data-sources/batch-jobs` | BatchJob 목록 (상태별 필터) |

### 수정

| Method | 경로 | 변경 내용 |
|--------|------|----------|
| POST | `/admin/data-sources/upload` | `mode` Form 필드 추가 (`standard` \| `batch`) |

### 백엔드 검증

- `mode=batch` + `GEMINI_TIER=free` → HTTP 400 ("배치 처리는 유료 티어에서만 사용 가능합니다")

---

## Admin UI 변경

### 업로드 폼

- 처리 방식 라디오 버튼 추가: `즉시 처리` / `배치 처리 (50% 할인)`
- Free tier: 배치 처리 disabled + "유료 전용" 뱃지
- `GET /admin/settings/config` 응답으로 티어 판별

### 배치 작업 상태 섹션

기존 업로드 상태 영역 아래에 배치 작업 목록 표시:
- `GET /admin/data-sources/batch-jobs`로 목록 조회
- 상태별 아이콘: pending(시계), processing(스피너), completed(체크), failed(X)
- pending/processing 상태가 있으면 10초 간격 폴링, 없으면 중단

---

## 에러 처리

| 상황 | 처리 |
|------|------|
| Batch 제출 실패 (API 오류) | BatchJob status=failed, 토스트 에러, 재시도는 재업로드 |
| Batch 처리 중 Gemini 서버 오류 | 폴링 시 감지 → status=failed + error_message |
| 완료 후 Qdrant 적재 실패 | status=failed, 임시 JSONL 보존 (수동 재시도 가능) |
| 중복 업로드 (같은 파일명) | UUID5 기반 chunk ID → 동일 청크는 덮어쓰기 |
| 서버 재시작 시 pending 작업 | 앱 시작 시 pending BatchJob 폴링 재개 |
| Free tier에서 batch 모드 요청 | 백엔드 400 에러 (UI에서도 차단하지만 이중 방어) |

**하지 않는 것:**
- 자동 재시도 — 실패 시 사용자가 재업로드 (YAGNI)
- 부분 완료 — Batch API는 전체 성공/실패만 반환

---

## 파일 구조

| Action | Path | 책임 |
|--------|------|------|
| Create | `backend/src/pipeline/batch_embedder.py` | Gemini Batch API 제출/폴링/결과 처리 |
| Create | `backend/src/pipeline/models.py` | BatchJob, BatchStatus 모델 |
| Create | `backend/alembic/versions/xxxx_add_batch_jobs.py` | 마이그레이션 |
| Modify | `backend/src/admin/data_router.py` | upload에 mode 파라미터, batch-jobs 엔드포인트 |
| Modify | `backend/src/admin/router.py` | GET /admin/settings/config 추가 |
| Modify | `admin/src/app/(dashboard)/data-sources/page.tsx` | 모드 선택 UI + 배치 상태 섹션 |

---

## 비용 시뮬레이션

615권 초기 적재 기준 (약 60만 청크, ~3억 토큰 추정):

| 항목 | Standard | Batch |
|------|----------|-------|
| 단가 | $0.15/M tokens | $0.075/M tokens |
| 총 비용 | ~$45 | ~$22.5 |
| **절감액** | — | **$22.5 (50%)** |
| 처리 시간 | ~2.5시간 (paid tier) | ~24시간 이내 |
