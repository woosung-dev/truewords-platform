# PLAN-HD-006 — 훈독 알림 1종 (Phase 4 · 코드 먼저, 운영 ON 은 데이터 뒤)

- 착수 2026-09-22. 기준 main `046088a`. 통합 브랜치 `dev/hoondok-phase4`, 산출은 dev→main **PR 1개**.
- 상위: [`PLAN-HD-001` §7](2026-09-17-hoondok-mvp.md) Phase 4. 이 문서는 오케스트레이터가 소유한다 — 트랙 서브에이전트는 편집하지 않는다.
- 표기: 라벨 없는 문장은 코드로 확인한 사실. `[가정]` 은 검증이 필요한 추론, `[확인 필요]` 는 사용자·외부 결정.

## 1. 왜 지금, 무엇을 바꾸는가

`PLAN-HD-001` §7 은 Phase 4 를 "Phase 3 데이터(7일 중 5일 완료 비율·D7 재방문)를 본 뒤 착수" 로 막았다. 2026-09-22 현재 실기기 증거 ⬜ · `mission_logs` 7일 적재 ⬜ 라 판정 데이터가 없다.

**2026-09-22 결정**: 게이트를 "착수" 에서 **"운영 ON"** 으로 옮긴다. 코드(구독 API·발송기·SW push·설정 토글)는 지금 구현·머지하되, VAPID 키가 없으면 설정 화면의 알림 토글은 지금과 같은 "준비 중" 이고 발송기는 exit 0 으로 아무것도 하지 않는다. 운영에서 알림을 켜는 것은 VM `.env` 3줄 + backend 재시작이며, 그 시점은 실기기 증거 + 7일 데이터 뒤 별도 승인이다.

## 2. 확정값

| # | 항목 | 값 | 근거 |
|---|---|---|---|
| 1 | 알림 종류 | **훈독하기 1종만.** 기도·가정예배·공지 토글은 "준비 중" 유지 | §7 "알림 4종 중 훈독 알림만" |
| 2 | 발송 시각 | **사용자별** `read_time`(기본 06:00, KST 고정). 오늘 `read` 완료자는 생략 | 사용자 결정 2026-09-22 · PRD F7 "시간을 사용자가 정한다" |
| 3 | 시각 저장 위치 | 새 테이블 `notification_preferences`. **정정**: `reminder_time` 은 `users` 가 아니라 `jeongseong_periods` 에만 있다(`hoondok/models.py:85`) | 사실 정정 |
| 4 | VAPID 공개키 전달 (D1) | `GET /hoondok/push/config`(공개) 로 **런타임** 전달. §7 의 turbo.json·Makefile build-arg 동기화는 하지 않는다 | 운영 ON 이 web 재빌드 없이 끝나고 "미설정 → 준비 중" 이 런타임 판정이 된다 |
| 5 | 발송 관측 (D2) | `push_subscriptions.last_sent_on`·`failed_count` + `ops-check` psql 검사 `hoondok-push` | `hoondok-today` 와 같은 패턴. 상태 파일·테이블 추가 없음 |
| 6 | 스케줄러 | VM cron `*/15 * * * *` → `send-hoondok-push.sh` → `docker compose exec backend python scripts/send_hoondok_push.py --execute`. **GHA cron 금지** | 청구 차단 이력 · `infra/oracle-vm/README.md` §정기 작업 |
| 7 | 발송 창 `[가정]` | `read_time` 이후 2시간. 창을 지나면 그날은 보내지 않는다 | 늦은 아침 알림 방지 |
| 8 | 구독 정리 `[가정]` | 404/410 즉시 삭제, 그 외 실패 `failed_count` 누적 5회에 삭제 | ARCH-MONO-001 §7 "만료 404/410 정리" |
| 9 | 잠금화면 문구 | `lock_screen_level` `neutral`(기본 "오늘의 읽을거리가 준비됐어요") · `faith`("오늘의 말씀이 준비됐어요") | S0 중립형 기본 · 프로토타입 015 |
| 10 | 앱 내 알림함 | **비범위.** F7 의 "최종 전달 수단" 은 다음 계획 | TODO Questions 기록 |

## 3. 범위 — 테이블 2 · API 4 · 스크립트 1 · 화면 1 부분

- `ENT-HD-008 notification_preferences` · `ENT-HD-009 push_subscriptions` (additive-only, PG ENUM 금지, alembic `down_revision=l6b7c8d9e0f1`). 계정 하드 삭제 purger 등록.
- `API-HD-019 GET /hoondok/push/config` · `API-HD-020 GET·PUT /hoondok/me/notifications` · `API-HD-021 POST /hoondok/me/push` · `API-HD-022 DELETE /hoondok/me/push`. 상세는 [`hoondok-api.md`](../../specs/api/hoondok-api.md).
- `apps/api/scripts/send_hoondok_push.py`(`--dry-run/--execute/--to-email`), `infra/oracle-vm/send-hoondok-push.sh`, `ops-check.sh` `hoondok-push`, `apps/api/scripts/hoondok_beta_metrics.sql`(베타 판정 쿼리 2개).
- web: `public/hoondok/sw.js` `push`·`notificationclick`, `features/hoondok/notifications/`, 설정 화면 "훈독하기" 행 활성.

## 4. 트랙·파일 소유

| 트랙 | 브랜치 | 소유 파일 | 상태 |
|---|---|---|---|
| 0 문서 | `dev/hoondok-phase4` 직접 | 이 문서 · `PLAN-HD-001` §7 개정 · `docs/TODO.md` · rollout runbook 알림 절 · `docs/README.md` | 진행 중 |
| A API | `feat/hoondok-push-api` | `apps/api/**` · `contracts/` · `packages/api-client-ts/src/generated/` · `hoondok-api.md`·`hoondok-entities.md`(예외 허용) | 진행 중 |
| B 발송기 | `feat/hoondok-push-sender` (A 스택) | `apps/api/scripts/{send_hoondok_push.py,hoondok_beta_metrics.sql}` · `apps/api/tests/test_send_hoondok_push.py` · `infra/oracle-vm/{send-hoondok-push.sh,ops-check.sh,README.md}` | A 뒤 |
| C web | `feat/hoondok-push-web` | `public/hoondok/sw.js` · `features/hoondok/notifications/**` · `settings/components/settings-screen.tsx` · `observability/report.ts` · `_hoondok/settings.css` · `src/test/hoondok-sw.test.ts` · `tests/e2e/hoondok.spec.ts` | 진행 중 |

**공유 파일(트랙 편집 금지)**: `apps/web/src/app/hoondok.css`, hoondok `layout.tsx`, `features/hoondok/{tabs,screens,flag}.ts`, `components/hoondok/*`, `Makefile`. 필요 시 보고만 하고 오케스트레이터가 처리한다.

## 5. 검증 게이트

1. 트랙별 `--no-ff` 로컬 머지 → 2. `make ci` → 3. `make e2e` → 4. codex 리뷰 ≤2회 → 5. dev→main PR(사용자 승인 후 push).
로컬 라이브: VAPID 키 생성 → `apps/api/.env` → `/hoondok/settings` 토글 활성 → `--to-email` 발송. **Chromium 헤드리스는 실제 푸시 서비스가 없어 도착을 증명하지 못한다** — 실기기 증거 양식(runbook)에 Phase 4 행을 두고 사용자가 채운다.

## 6. 운영 ON 게이트 (이번 PR 비범위)

실기기 증거 ✅ → 초대 → `mission_logs` 7일 적재 → `hoondok_beta_metrics.sql` 2수치 → 사용자 승인 → runbook "알림 운영 ON 절차"(VAPID 생성 → VM `.env` 3줄 → backend 재생성 → cron 등록 → `--to-email` 실기기 → ops-check). 각 `make deploy-*` 단계별 승인.

## 7. 진행 기록

| 시각 | 사건 | 결과 |
|---|---|---|
| 2026-09-22 | 착수 게이트 질문 → "코드 먼저, 운영 ON 은 데이터 뒤" · 발송 시각 "사용자별, 완료자 생략" | 확정 (§2 1·2) |
| 2026-09-22 | `API-HD-018` 은 client-errors 가 선점 → 새 번호 019~022, ENT 008·009 | 정정 |
| 2026-09-22 | 브랜치 `dev/hoondok-phase4` + worktree A·C 생성, 병렬 착수 | 진행 |

## 8. 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-22 | Phase 4 게이트를 "착수" → "운영 ON" 으로. 코드는 VAPID 미설정 시 비활성 | 확정 |
| 2026-09-22 | 발송 시각 사용자별 `read_time` + 오늘 완료자 생략 + KST 고정 | 확정 |
| 2026-09-22 | VAPID 공개키는 런타임 API(D1), 관측은 컬럼+ops-check(D2) | 확정 |
| 2026-09-22 | 앱 내 알림함·알림 3종·이메일 인프라는 비범위 | 확정 |
