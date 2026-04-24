# Alembic advisory lock PoC — §19.11 O-5 + §21.8 B4

- **작성일**: 2026-04-25
- **상태**: PoC 완료 (단위 테스트 22 PASS + 통합 실측 4 시나리오 모두 의도대로 동작)
- **관련 파일**: `backend/alembic/env.py`, `backend/src/alembic_support/advisory_lock.py`, `backend/tests/test_alembic_advisory_lock.py`, 플랜 §19.11 O-5 / §21.8 B4 / §22.7 N4

## 왜

리팩토링 선행 체크리스트 #4 (플랜 §19.12). Cloud Run 등에서 여러 replica가 동시에 `alembic upgrade head`를 수행할 때의 경합을 `pg_try_advisory_lock` 으로 직렬화하는 것이 §19.11 O-5의 설계. §21.8 B4는 skip 분기의 안전장치 — `ALEMBIC_EXPECTED_HEAD` 환경변수로 현재 DB head가 기대값과 일치할 때만 skip을 허용 — 를 요구.

기본 OFF로 도입해 기존 alembic 동작을 보존. 환경변수 `ALEMBIC_USE_ADVISORY_LOCK=true` 로만 활성화.

## 구현

### 파일

| 경로 | 성격 | 핵심 |
|------|------|------|
| `backend/src/alembic_support/__init__.py` | 신규 | 빈 패키지 marker |
| `backend/src/alembic_support/advisory_lock.py` | 신규 | `run_with_lock`, `_acquire`, `_release`, `_handle_miss`, `_current_db_head`, `is_enabled` |
| `backend/alembic/env.py` | 수정 | `do_run_migrations`에 `is_enabled()` 분기 + `run_with_lock` 옵션 |
| `backend/tests/test_alembic_advisory_lock.py` | 신규 | 단위 테스트 22개 |

### 토글 환경변수

| 변수 | 기본값 | 의미 |
|------|--------|------|
| `ALEMBIC_USE_ADVISORY_LOCK` | `false` | 전체 활성화 스위치 |
| `ALEMBIC_LOCK_KEY` | `12345` | `pg_try_advisory_lock` 키 |
| `ALEMBIC_LOCK_TIMEOUT_SEC` | `300` | lock 획득 대기 (초) |
| `ALEMBIC_SKIP_IF_LOCKED` | `false` | timeout 시 skip 분기 진입 |
| `ALEMBIC_EXPECTED_HEAD` | — | skip 허용 전 DB head 검증값 |

### 분기

```
acquire lock (pg_try_advisory_lock 폴링 up to timeout)
├─ success: run migrations → release
└─ miss (timeout):
   ├─ ALEMBIC_SKIP_IF_LOCKED=false → RuntimeError "Failed to acquire..."
   └─ ALEMBIC_SKIP_IF_LOCKED=true:
      ├─ ALEMBIC_EXPECTED_HEAD 미설정 → WARN + skip (unsafe)
      └─ 설정:
         ├─ current DB head == expected → skip
         └─ 불일치 → RuntimeError "Cannot skip migration: DB head=... expected=..."
```

async alembic env.py 와의 통합은 `run_sync` 블록 내부에서 sync `Connection` 을 그대로 인자로 넘겨 구현 — 별도 async adapter 불필요. 예외 발생 시 `finally`에서 unlock 보장.

## 단위 테스트 결과

```
$ uv run pytest tests/test_alembic_advisory_lock.py -v
...
22 passed in 0.12s
```

주요 케이스:
- `_bool_env` 파싱 (true/TRUE/1/yes/on → True, 나머지 False, 공백 trim)
- `_int_env` 숫자/오류값 fallback
- `is_enabled` 기본 OFF
- `_handle_miss` 4 분기 (skip 비활성 raise / skip + expected 미설정 warn / skip + 일치 skip / skip + 불일치 raise)
- `_current_db_head` 정상 / 에러 / 빈 테이블

## 통합 실측 (수동)

### 환경

- 로컬 독립 PG 컨테이너 `alembic-poc-pg` (postgres:17-alpine, 5433→5432)
  - 기존 `backend/docker-compose.yml`의 postgres 서비스는 사용자의 다른 프로젝트(`quantbridge-db`)가 5432를 점유 중이라 별도 포트로 분리.
- DATABASE_URL: `postgresql+asyncpg://truewords:truewords@localhost:5433/truewords`
- 초기 `alembic upgrade head` 로 head=`7a344c99c625` 확립.

### lock holder (경합 시뮬레이션)

```bash
docker exec alembic-poc-pg psql -U truewords -d truewords \
  -c "SELECT pg_advisory_lock(12345), pg_sleep(30);" &
```

### 시나리오 1 — no contention + lock 활성
```
$ env ALEMBIC_USE_ADVISORY_LOCK=true ALEMBIC_LOCK_TIMEOUT_SEC=5 alembic upgrade head
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
elapsed=0s
```
→ lock 즉시 획득 → no-op(이미 head) → unlock → exit 0.

### 시나리오 2 — 경합 → timeout raise
```
$ env ALEMBIC_USE_ADVISORY_LOCK=true ALEMBIC_LOCK_TIMEOUT_SEC=3 alembic upgrade head
...
RuntimeError: Failed to acquire alembic advisory lock within 3s
elapsed=4s
```
→ timeout 3초 + alembic 초기화 ~1초, exit 1. 의도대로.

### 시나리오 3 — 경합 + skip + correct head
```
$ env ALEMBIC_USE_ADVISORY_LOCK=true ALEMBIC_LOCK_TIMEOUT_SEC=3 \
      ALEMBIC_SKIP_IF_LOCKED=true ALEMBIC_EXPECTED_HEAD=7a344c99c625 \
      alembic upgrade head
[alembic/lock] skipping (DB head matches expected=7a344c99c625)
elapsed=3s
```
→ timeout 후 expected == current → skip → exit 0.

### 시나리오 4 — 경합 + skip + wrong head
```
$ env ALEMBIC_USE_ADVISORY_LOCK=true ALEMBIC_LOCK_TIMEOUT_SEC=3 \
      ALEMBIC_SKIP_IF_LOCKED=true ALEMBIC_EXPECTED_HEAD=WRONG_HEAD \
      alembic upgrade head
...
RuntimeError: Cannot skip migration: DB head='7a344c99c625', expected='WRONG_HEAD'. Another replica may be migrating. Retry after wait.
elapsed=4s
```
→ expected 불일치 → RuntimeError, exit 1. 의도대로.

## 관찰

- 폴링 주기 `time.sleep(min(2.0, remaining))` — timeout 3초 설정 시 약 2회 폴링, 실제 elapsed는 `timeout + alembic 초기화 시간`에 지배적.
- `run_sync` 블록 안의 sync `Connection`으로 lock·unlock 모두 호출 가능. async 우려 없음.
- 시나리오 2/4의 traceback은 alembic 상위 프레임까지 전파 — env.py의 RuntimeError가 프로세스 exit 1로 이어지므로 Cloud Run 컨테이너에서 정상 실패 시그널로 동작 예상.

## 현재 scope에서 제외 (후속 과제)

- **Cloud Run 실환경 검증**: 운영 env에 `ALEMBIC_USE_ADVISORY_LOCK=true` 주입 + 실제 2+ replica 동시 배포 시나리오는 선행 #2 Staging 분리 이후.
- **`ALEMBIC_EXPECTED_HEAD` 자동 주입**: `alembic heads | head -1 | cut -d' ' -f1` 을 Dockerfile 빌드 단계 또는 Cloud Build step에서 `ALEMBIC_EXPECTED_HEAD` env 로 저장. §22.7 N4 (ALEMBIC_EXPECTED_HEAD artifact 고정 + `_is_ancestor` rollback 허용)와 함께 통합.
- **다른 DB 엔진 대비**: 현재 로직은 PostgreSQL `pg_try_advisory_lock` 전용. 다른 엔진 지원 필요 시 별도 설계.

## 다음 단계

- 선행 #2 Staging 환경 분리 → #3 운영 Qdrant payload dry-run → #5 품질 게이트 기준선 순서. 인프라 준비 후 별도 세션.
- R2 ChatbotRuntimeConfig 승격 또는 본작업 착수 시 `ALEMBIC_USE_ADVISORY_LOCK=true` 활성화 여부를 같이 결정 (Cloud Run 실환경 스모크 테스트 필요).
