# 선행 #4.1 — Alembic 배치 Backfill PoC (§19.15 X-1)

- **작성일**: 2026-04-25
- **상태**: 완료 (단위 6 PASS + 통합 실측 500 row PASS)
- **관련 파일**:
  - `backend/src/alembic_support/batch_backfill.py` (신규)
  - `backend/scripts/backfill_sample.py` (신규 · 템플릿)
  - `backend/tests/test_batch_backfill.py` (신규)
  - 플랜 §19.15 X-1

## 왜

§19.15 X-1 설계. Alembic migration 이 대규모 backfill 을 포함하면:

- 단일 트랜잭션 내 수백만 row 업데이트 → 메모리 급증 + long-running tx + lock 경합
- Alembic 기본 트랜잭션 모델(`with context.begin_transaction()`)과 구조 충돌

해결 패턴: **Alembic 은 스키마만** (nullable 컬럼 + partial index) + **Backfill 은 별도 Python 스크립트**에서 **배치별 독립 commit**.

## 구현

### `src/alembic_support/batch_backfill.py` — Generic async utility

```python
async def run_batch_backfill(
    session_factory,
    update_sql: str,
    *,
    batch_size: int = 1000,
    sleep_between_batches: float = 0.1,
    max_batches: int | None = None,
    params: dict | None = None,
) -> int
```

- 각 배치마다 독립 `async with session_factory()` + `session.commit()`
- `updated == 0` 까지 반복 (또는 `max_batches` 안전장치)
- 배치 간 `asyncio.sleep` 으로 lock 경쟁 완화
- driver rowcount 미지원 시 -1 → 0 fallback

권장 SQL 구조:
```sql
UPDATE target
SET col = ...
WHERE id IN (
    SELECT id FROM target
    WHERE col IS NULL
    LIMIT :n
    FOR UPDATE SKIP LOCKED
)
RETURNING id
```

### `scripts/backfill_sample.py` — 운영 backfill 템플릿

실제 운영 시 이 파일을 `backfill_<feature>.py` 로 복사 → `SAMPLE_UPDATE_SQL` + 파라미터 교체. `settings.database_url` 로 engine 생성 → session_factory → `run_batch_backfill`.

## 단위 테스트 (6 PASS, 0.15s)

| 케이스 | 검증 |
|--------|------|
| `test_stops_when_no_rows_updated` | rowcount=0 시 루프 종료 |
| `test_commits_per_batch_even_on_small_updates` | 작은 배치도 각각 commit |
| `test_respects_max_batches` | 상한 도달 시 종료 |
| `test_passes_extra_params` | WHERE 조건 등 추가 파라미터 전달 |
| `test_empty_first_batch_terminates` | 첫 배치 0 → 1회 commit 후 종료 |
| `test_negative_rowcount_treated_as_zero` | driver 미지원 방어 |

## 통합 실측 (로컬 PG `alembic-poc-pg`)

### 준비
```sql
CREATE TABLE _probe_backfill (id SERIAL PRIMARY KEY, src INT NOT NULL, dst TEXT)
INSERT INTO _probe_backfill (src) SELECT g FROM generate_series(1, 500) g
```

### 실행
```python
await run_batch_backfill(factory, UPDATE_SQL, batch_size=150, sleep_between_batches=0)
```

### 결과
```
batch=1 updated=150 total=150
batch=2 updated=150 total=300
batch=3 updated=150 total=450
batch=4 updated=50  total=500
batch=5 updated=0   total=500    ← 종료 감지
```
검증: `TOTAL=500, null_after=0, dst_range=[1, 500]`.

- 500 row 전부 backfill 완료.
- 각 배치 독립 commit — 중간 crash 시 완료된 배치 보존.
- 빈 배치(updated=0) 로 루프 종료.

5 배치 총 실행시간 ~9ms (500 row · localhost PG). 실사용 수백만 row 에서는 `sleep_between_batches=0.1~1.0` 으로 lock 경쟁 완화 필요.

## 실사용 가이드 (운영 migration 시)

1. **Migration A**: `nullable=True` 컬럼 + `partial index WHERE col IS NULL` 추가.
2. 배포 후 `scripts/backfill_<feature>.py` (템플릿 복사본) 실행.
3. 완료 확인: `SELECT COUNT(*) FROM target WHERE col IS NULL` → `0`.
4. **Migration B**: `alter column NOT NULL` 제약 추가.

## 제약

- **단일 프로세스 기준**. 다중 프로세스 동시 실행 시 `FOR UPDATE SKIP LOCKED` 로 row 경합은 회피하나, batch_size 누적은 프로세스별. 전체 완료 확인은 NULL 카운트로.
- `RETURNING id` 대신 `RETURNING *` 은 네트워크 비용 증가. id 만 권장.
- Alembic script 디렉터리 **밖**(`backend/scripts/` 또는 운영 팀 script)에서 실행. migration 내부 호출 금지.

## 다음 단계

- 이번 세션 이어서: 부수 S1 Gemini 클라이언트 단일화 → 부수 S3 프론트 챗봇 폼 중복 제거.
- R3 (Payload 통일) 단계에서 이 유틸을 **Qdrant payload 재인덱싱에 활용** 가능 (단 Qdrant 는 PG 와 다른 트랜잭션 모델 — scroll+upsert 기반으로 별도 Qdrant-specific 헬퍼가 필요할 수 있음).
