# ADR-60: P1-2 chatbot/admin 이중 commit — 보류 결정 (audit 2차)

- 날짜: 2026-05-15
- 상태: **Accepted** (보류 — 코드 변경 0, 모니터링 trigger 명문화)
- 관련: PR #174 (1차 audit) / PR #177~#180 (2차 audit S1~S5) / `docs/dev-log/59-second-audit-auto-decisions.md`
- 사용자 결정 #3 (2026-05-15)

## 컨텍스트

`chatbot/router.py:63-97` 의 `create_config` / `update_config` 가 chatbot
설정 변경 commit 직후 `AdminService.log_audit` 를 직접 호출해 별도 audit log
commit 을 발행한다. 두 commit 사이에 시스템 장애 시 chatbot 설정만 남고
audit log 가 누락될 가능성이 1차 audit (2026-05-15) 시점 P1-2 로 제기됐다.

1차 audit 자동 선택 단계 (`57-backend-audit-auto-decisions.md`) 에서 보류
처리. 2차 audit 6인 (`59-second-audit-auto-decisions.md`) 의 메타 의견은
split:

| 메타 | 의견 | 근거 |
|------|------|------|
| Agent C (claude) | ADR 로 닫기 | FastAPI Depends 캐시로 동일 AsyncSession 공유. SQLAlchemy autoflush. 이중 commit no-op 가정. |
| opus meta α | ADR 로 닫기 | session 공유 시 위험 미미. 코드 변경 비용 vs ROI 균형. |
| codex meta β | 즉시 fix | admin mutation 누적, audit 누락 위험 강조. chatbot/router 직접 호출 패턴 자체가 도메인 격리 위반. |

사용자 결정: **ADR 로 닫기**. 세 메타 의견 중 둘 합의 + 코드 변경 비용 vs
실 위험도 균형. 단 향후 위반 시점 명문화.

## 결정

### 1. 현 시점 코드 변경 0

- `chatbot/router.create_config` / `update_config` 의 `admin_service.log_audit`
  직접 호출 그대로 유지.
- `chatbot_service` 와 `admin_service` 가 `get_chatbot_service` /
  `get_admin_service` Depends 체인을 통해 동일 `AsyncSession` 을 공유한다는
  가정에 의존. (실 검증은 `chat/dependencies.py` / `chatbot/dependencies.py`
  / `admin/dependencies.py` 의 session DI 구조 분석으로 충분.)

### 2. 위반 시점 trigger — 즉시 B-2 facade 도입

다음 한 가지라도 충족하면 즉시 `chatbot/router` → `chatbot_service.create_with_audit()` (또는 audit decorator) 로 패턴 변경:

- (a) chatbot CRUD 도중 audit log 누락이 1건이라도 운영 로그에서 관찰됨
- (b) `get_chatbot_service` / `get_admin_service` 의 session DI 구조가 변경되어
      두 service 가 별도 session 으로 분리됨
- (c) chatbot 외 도메인 (예: datasource / chat) 에 동일 "router → 타 도메인
      service" 패턴이 추가됨 — 즉 패턴 자체가 prolif 됨

### 3. 모니터링

- audit_log 테이블 일자별 row count 와 chatbot_configs UPDATE timestamp 분포
  비교 — 누락 1건이라도 발견 시 trigger (a) 발효
- `feat/admin*` PR 머지마다 chatbot/router create/update 경로 회귀 확인 — DI
  구조 변경 시 trigger (b) 발효

## 대안 (기각 사유)

### 즉시 fix — `ChatbotService.create_with_audit(data, admin_user_id)` facade
- 장점: 도메인 격리 명확. cross-domain 의존 제거. test 안정성↑.
- 기각 사유: 실 위험 (audit 누락 사례 0) 대비 코드 변경 범위 큼. session
  공유 가정 하에 no-op 수준.

### audit log decorator 도입
- 장점: 모든 mutation endpoint 에 audit 자동 — 누락 원천 차단.
- 기각 사유: 별도 큰 작업 (cross-cutting concern). 본 audit 범위 외.

## 관련 결정 로그

- `docs/dev-log/57-backend-audit-auto-decisions.md` — 1차 audit P1-2 보류
- `docs/dev-log/59-second-audit-auto-decisions.md` §5 — 2차 audit 메타 의견 + 사용자 결정 #3
- `memory/feedback_integration_branch_pr_pattern.md` — 통합 브랜치 패턴 (S6 작업 정합)
