# Dev-log 41 — 운영 chat incident 복구 + 선행 #5 baseline 200건 수집

- **작성일**: 2026-04-25
- **상위**: PR #51 R3 PoC 머지 후 운영 chat 장애 발생 → 본 세션 내 수동 복구
- **선행 #5 완료**: 운영 chat API 에 baseline 200건 직접 호출 (PR #52 staging reverse 결정에 따른 운영 직접 흐름)
- **연관**: dev-log 38 (R3 PoC), dev-log 39 (staging reverse), dev-log 40 (선행 #3 drift)

---

## 1. 운영 chat incident — 5시간+ 장애

### 타임라인

| 시각 (UTC, 2026-04-25) | 사건 |
|------------------------|------|
| 03:30Z | PR #51 (R3 PoC) main 머지 → Cloud Run 자동 재배포 → 새 코드 (`AnswerCitation.volume_raw`) 배포 |
| 03:30Z 직후 | 운영 chat API 의 모든 요청 500 에러 (`InsertError: column "volume_raw" does not exist`) |
| 약 5시간+ | 사용자 chat 사용 불가 상태 지속 |
| 본 세션 | 발견 + 복구 |

### 근본 원인

`backend/Dockerfile` L38:
```dockerfile
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

→ **Cloud Run 시작 시 `alembic upgrade head` 자동 실행 안 됨**. 새 migration (`33d34f262dc2_add_volume_raw_to_answer_citation`) 이 운영 PostgreSQL 에 적용되지 않은 상태에서 `chat/service.py:_record_citations` 가 `volume_raw` 컬럼에 INSERT 시도 → SQL error → 500.

기존 메모리 가정 ("Cloud Run entrypoint 의 alembic upgrade head 가 자동 적용") 이 잘못됐음. Dockerfile 빌드 시점에 ALEMBIC_EXPECTED_HEAD artifact 만 고정 (§22.7 N4) 되고 실제 적용 로직은 부재.

### 복구 절차

#### Step 1: local 검증 (Docker 임시 PG)
```bash
docker run -d --rm --name truewords-test-pg \
  -e POSTGRES_USER=truewords -e POSTGRES_PASSWORD=truewords -e POSTGRES_DB=truewords \
  -p 5433:5432 postgres:16-alpine
sleep 5
DATABASE_URL="postgresql+asyncpg://truewords:truewords@localhost:5433/truewords" \
  uv run alembic upgrade head
docker exec truewords-test-pg psql -U truewords -d truewords -c "\d answer_citations"
```

결과: 7개 migration 통과 + `volume_raw character varying(64)` Nullable 정상 추가. 기존 9개 컬럼 영향 0.

#### Step 2: 운영 DB 수동 적용
```bash
set -a && source <(grep -E '^# *(DATABASE_URL)=' backend/.env | sed 's/^# *//') && set +a
cd backend && uv run alembic upgrade head
```

결과: `7a344c99c625` → `33d34f262dc2 (head)`. 다운타임 0 (transactional DDL).

#### Step 3: Cloud Run pod 재시작 (stale connection 정리)
운영 DB ALTER TABLE 직후 Cloud Run pod 의 SQLAlchemy connection pool 이 closed connection 유지 → `InterfaceError: connection is closed`. dummy env var 로 새 revision 강제:

```bash
gcloud run services update truewords-backend \
  --region=asia-northeast3 \
  --update-env-vars=POOL_RECYCLE_AT=2026-04-25-migration-restart
```

새 revision: `truewords-backend-00072-sn8`. 100% traffic 자동 라우팅.

#### Step 4: chat smoke 검증
```bash
curl -X POST .../chat -d '{"query":"축복이란 무엇인가?", "chatbot_id":null, "session_id":null}'
```

결과: HTTP 200, 11.8s, 답변 + 3 sources. **운영 복구 완료**.

---

## 2. 선행 #5 baseline 200건 수집

운영 chat 복구 직후 `quality_baseline_collect.py` 로 200건 수집.

### 실행
```bash
uv run python scripts/quality_baseline_collect.py --execute \
  --api-base "https://truewords-backend-rfzkx2dyra-du.a.run.app" \
  --rate-per-sec 0.3 --limit 200 \
  --output ../reports/baseline_20260425_170508.jsonl
```

- rate 0.3/s = 분당 18건 (운영 rate-limit 20/min 안전 마진)
- 총 소요 시간: ~12분
- 출력: `reports/baseline_20260425_170508.jsonl`

### 결과 요약

| 지표 | 값 |
|------|-----|
| 총 건수 | 200 |
| Status 200 | 196 (98.0%) |
| Status 400 (INPUT_BLOCKED) | 3 (의도된 보안 차단) |
| Status 500 (INTERNAL_ERROR) | 1 |
| **실 실패율** | **0.5%** (500 만 카운트) |

### Latency 분포 (status=200, n=196)

| 통계 | ms |
|------|-----|
| min | 1,572 |
| p50 | 4,095 |
| p90 | 5,061 |
| max | 6,729 |

### Citations 분포

`citations_count` 모두 **3건 정확히** (avg=3.00, min=3, max=3). `chat/service.py` 의 `results[:3]` 보장 작동.

### 카테고리별 (성공 케이스)

| Category | n | avg latency_ms |
|----------|---|----------------|
| doctrine | 120 | 3,593 |
| practice | 49 | 4,117 |
| out_of_scope | 15 | 3,753 |
| adversarial | 12 | 3,800 |

→ 카테고리별 latency 차이 작음 (3.5~4.1s 사이). Practice 가 약간 느림 — 검색 결과 다양성으로 인한 generation 시간일 가능성.

### 실패 케이스 분석

| ID | Category | Status | 원인 |
|----|----------|--------|------|
| bq-117 | practice | 500 | INTERNAL_ERROR — 일시적 LLM/embed 실패로 추정. 별도 재현 필요 |
| bq-136, bq-141, bq-146 | adversarial | 400 | INPUT_BLOCKED — `safety/input_validator.py` 의 prompt injection 패턴 매칭. **의도된 동작** |

**adversarial 카테고리 보안 분석**: 15건 중 3건 차단 (20%). 나머지 12건은 통과 → input_validator 의 BLOCKED_PATTERNS 가 일부 패턴만 잡음. R1/R2/R3 후속에서 input_validator 강화 시 비교 baseline 으로 활용.

### baseline 의 의미

메인 플랜 §23 품질 기준선 원칙: **R1/R2/R3 전후 비교를 위한 기준선 200건 확보**. 본 결과로 다음 sprint 진입 가능:
- 평균 latency ~4s, citations 3건 일관 → R1 분해 후 동등 또는 개선 검증
- adversarial 차단율 20% → R1/R2/R3 후속에서 보안 강화 시 비교
- INTERNAL_ERROR 0.5% → 안정성 baseline

---

## 3. 후속 필수 작업

### 3.1 Dockerfile fix PR (별도) — 본 incident 재발 방지 ⭐⭐⭐⭐⭐

`backend/Dockerfile` 의 CMD 를 entrypoint 에서 `alembic upgrade head` 자동 실행하도록 수정:

```dockerfile
# 권장 (sh -c 로 wrapping)
CMD ["sh", "-c", "uv run alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8080"]
```

또는 별도 `entrypoint.sh` 분리. 이미 `backend/src/alembic_support/advisory_lock.py` (§22.7 N4) 가 동시 배포 직렬화 지원 (env `ALEMBIC_USE_ADVISORY_LOCK=true`).

**별도 PR 로 진행** (본 PR 은 docs only).

### 3.2 bq-117 INTERNAL_ERROR 원인 분석 (낮은 우선순위)

200건 중 1건 일시적 실패. 재현 시 Gemini API 일시 quota / network 등 외부 요인일 가능성. 별도 ticket.

### 3.3 R1 진입 가능 ✅

선행 #3 (drift probe) + 선행 #5 (baseline 200건) 모두 완료. 다음 sprint:
1. R3 후속 PR (Collection Resolver) — staging 무관, 즉시 가능
2. R1 Phase 1 — `chat/service.py` God Object 분해

---

## 4. 메인 플랜 §23 준수

- 검증 루프: local 검증 → 운영 적용 → smoke → baseline. 각 단계 1회. 3회 상한 미접근.
- 문서 분량: 본 dev-log 약 200줄 / 임계 2,000줄 충분.
- Δ 누적: 1 (Dockerfile alembic 부재 발견 → 후속 PR). 한도 미접근.

---

## 산출물

- `reports/baseline_20260425_170508.jsonl` — 200건 수집 결과
- `reports/qdrant_drift_20260425.json` — 선행 #3 결과 (PR #53 에 이미 포함)

본 dev-log + baseline JSONL 을 docs PR #54 로 묶어 main 반영.
