# v4.1 N4 — ALEMBIC_EXPECTED_HEAD 빌드 artifact + `_is_ancestor` rollback 허용

- **작성일**: 2026-04-25
- **상태**: 구현 완료 (단위 테스트 39 PASS). Cloud Run 실배포 검증은 staging 구축(선행 #2 인프라 프로비저닝) 후.
- **관련 파일**: `backend/Dockerfile`, `backend/src/alembic_support/advisory_lock.py`, `backend/tests/test_alembic_advisory_lock.py`, 플랜 §22.7 N4

## 왜

v4.1 스팟 패치 N4. 선행 #4(dev-log 26)에서 구현한 advisory lock skip 분기가 `ALEMBIC_EXPECTED_HEAD` 환경변수에 의존하지만, 배포 시나리오에서 두 가지 공백이 있었음:

1. **주입 경로 불명확** — CI/Cloud Build 에서 `alembic heads | head -1` 을 매 배포마다 계산해 env 로 주입하는 패턴은 작동하지만, 이미지와 expected head가 분리되어 이미지 rollback 시 head 값이 꼬일 수 있음. **빌드 artifact 로 고정** 필요.
2. **Rollback 불허** — 현재 `_handle_miss` 는 `expected == current` 만 skip. 그러나 rollback 시나리오(신 DB 배포 후 구 image scale-out) 에서는 `expected`(구 image 가 기대) 가 `current`(신 DB) 의 **조상**이면 구 image 도 정상 동작 가능해야 함.

## 구현

### Dockerfile — builder 스테이지에서 head 고정

```dockerfile
# 소스 코드 복사 + 프로젝트 설치
COPY . .
RUN uv sync --frozen --no-dev

# §22.7 N4: 빌드 시점의 alembic head 를 artifact 로 고정.
RUN uv run alembic heads | head -1 | awk '{print $1}' > /app/ALEMBIC_EXPECTED_HEAD \
 && echo "[build] ALEMBIC_EXPECTED_HEAD=$(cat /app/ALEMBIC_EXPECTED_HEAD)"
```

이미지 안에 `/app/ALEMBIC_EXPECTED_HEAD` 파일이 포함됨. 배포 시점에 `ALEMBIC_EXPECTED_HEAD` env 가 미설정이어도 이 파일에서 읽음 — **이미지와 expected head 가 1:1 묶임**.

### advisory_lock.py 확장

신규 함수 2개:

```python
def _expected_head() -> str:
    """env → 빌드 artifact 파일 (/app/ALEMBIC_EXPECTED_HEAD, ALEMBIC_EXPECTED_HEAD) 순 탐색.

    파일 내용은 첫 토큰만 사용 — alembic heads 출력이 'rev_id (head)' 형식이어도 안전.
    """

def _is_ancestor(expected: str, current: str, script_location: str = "alembic") -> bool:
    """expected 가 current 의 조상(또는 같음) 이면 True.

    alembic.script.ScriptDirectory.walk_revisions(base=expected, head=current) 사용.
    base 가 head 의 조상이 아니면 CommandError 발생 → False.
    """
```

`_handle_miss` 분기 확장:

```
skip 활성(ALEMBIC_SKIP_IF_LOCKED=true) 시:
  1. expected 미설정 → WARN + skip (unsafe)
  2. current == expected → skip (정상)
  3. _is_ancestor(expected, current) → skip (rollback-compatible) ← 신규
  4. 그 외 → RuntimeError
```

## 테스트 결과

```
$ uv run pytest tests/test_alembic_advisory_lock.py -v
...
39 passed in 0.29s
```

기존 22 + 신규 17:

| 그룹 | 케이스 수 | 내용 |
|------|-----------|------|
| `TestBoolEnv` | 10 | 기존 |
| `TestIntEnv` | 3 | 기존 |
| `TestIsEnabled` | 2 | 기존 |
| `TestExpectedHead` | **6** | env/file fallback, 공백/빈 처리, 첫 토큰 추출 |
| `TestIsAncestor` | **9** | same/ancestor/descendant/unknown/empty 조합 — 실 alembic script 사용 |
| `TestHandleMissBasic` | 3 | 기존 구조 유지 |
| `TestHandleMissAncestor` | **3** | ancestor skip / unrelated raise / descendant raise |
| `TestCurrentDbHead` | 3 | 기존 |

`TestIsAncestor` 는 backend 의 실제 alembic revision graph(`4019bf278be0` → ... → `7a344c99c625`) 를 사용. 향후 migration 추가로 head 가 바뀌면 `REV_HEAD` 상수 업데이트 필요 — 간단한 문자열 교체.

## 동작 요약 (4 시나리오 매트릭스)

배포 상황별 동작 (lock 경합 + skip 허용 가정):

| expected (구 image) | current (실 DB) | 분기 | 결과 |
|---------------------|-----------------|------|------|
| (미설정) | — | 1 | WARN + skip (unsafe) |
| A | A | 2 | skip (정상) |
| A (조상) | B (후손) | 3 | skip (rollback-compatible) |
| B | A (조상) | 4 | RuntimeError (구 DB + 신 image, migration 필요) |
| unknown | A | 4 | RuntimeError |

## 통합 실측 전략

단위 테스트 39 개로 ancestor / file fallback / 분기 로직을 이미 커버. 실 PG 기반 lock + ancestor 조합은 `mock conn + _is_ancestor(실 script)` 로 충분 — mock 은 `_current_db_head` 동작만 대체하고 `_is_ancestor` 는 실 alembic script 를 읽음.

진짜 배포 시나리오 검증은 **staging 환경 구축(선행 #2 인프라 프로비저닝) 후 Cloud Run 에서 rollback 시뮬레이션**으로 수행 예정. 해당 검증에는 2 개 이미지 태그(예: staging-old, staging-new) + advisory lock 경합 + DB head mismatch 가 필요한데, 로컬 `docker run` 으로는 이미지 승격 흐름이 재현 안 되므로 staging 필수.

## 후속 과제

- **Cloud Run 빌드 검증**: Artifact Registry 에 push 된 이미지에서 `/app/ALEMBIC_EXPECTED_HEAD` 파일이 생성돼 있는지 확인. `docker run --rm <image> cat /app/ALEMBIC_EXPECTED_HEAD`.
- **deploy.yml staging job 추가 시 env 주입 주의**: `ALEMBIC_EXPECTED_HEAD` 를 CI 에서 직접 계산해 env 로 주입하면 이 artifact 로직이 env 에 의해 override 당함. **env 는 명시 설정하지 않고 artifact 에 맡기는 것**이 N4 의 이점을 살림. staging 분리 설계 문서(§9) 업데이트 포함 필요.
- **staging rollback 테스트 시나리오** — 이미지 A(old head) 배포 → 이미지 B(new head) 배포 → 이미지 B 트래픽 100% → 이미지 A 로 revision 전환 → advisory lock 경합 상황 시뮬 → skip 분기의 `rollback-compatible` 경로 확인.

## 다음 단계

- v4.1 스팟 패치 나머지(N2 DI 스코프 / N3 FSM force_transition / N7 Legacy 태그)는 R1/R2/R3 본 리팩토링 맥락에서 수행(N4 만 독립).
- 선행 #2 인프라 프로비저닝 완료 후 Cloud Run 실배포 → N4 artifact 및 skip 분기 실환경 검증.
