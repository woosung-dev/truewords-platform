# PLAN-HD-010 — 훈독 함께 읽는 모임 (2단계)

- 작성 2026-09-23. 상태 **계획 확정, 미착수**. 결정 원본: [PRD F8·`DEC-PWA-023`](../../prd/17-ffwpu-pwa-prd.md), [DES-PWA-003 §5·§8](../../specs/web/hoondok-design-system.md), [벤치마크](../../research/2026-09-23-hoondok-together-benchmark.md), 프로토타입 [`hoondok-ds/app.html`](../../prd/prototypes/hoondok-ds/README.md) `group` · `group-join` · `group-create` · `group-share` · `group-settings`(`?role=member`).
- 1단계(익명 숫자)는 `PLAN-HD-009`(`docs/plans/active/2026-09-23-hoondok-together.md`, PR #318)가 끝냈다 — `API-HD-029` `GET /hoondok/today/together`, 설정 `HOONDOK_TOGETHER_MIN_COUNT=10`, alembic `q2b3c4d5e6f7`(`mission_logs(mission_date, kind)` 인덱스), web `features/hoondok/together/{api,use-together}.ts` · `components/together-card.tsx` · `app/_hoondok/together.css` · `TOGETHER_KEY ∈ PROGRESS_KEYS`. 이 계획은 그 위에 모임만 더한다. `[가정]` 이 문서 작성 시점에 #318 은 미머지라 링크 대신 경로로 적는다.
- 착수 기준: **#317(프로토타입·`DEC-PWA-023`)과 #318 이 main 에 머지된 뒤** main 에서 통합 브랜치 `dev/hoondok-groups` 를 자른다. #318 이 착수 시점까지 안 들어갔으면 #318 위에 쌓는다. sub-task PR 은 [통합 브랜치 runbook](../../runbooks/integration-branch-workflow.md) 을 따른다.
- 표기: 라벨 없는 문장은 코드로 확인한 사실(2026-09-23, main `5116525` + #318). `[가정]` 은 추론, `[확인 필요]` 는 사용자·외부 결정.
- ID: API `API-HD-030~043`(029 까지 사용), 엔티티 `ENT-HD-013~017`(main·#318 모두 012 까지), 화면 `SCR-PWA-017~021`.

## 1. 결정 기록 (2026-09-23 사용자 결정, 재논의 금지)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 오늘 범위 리더 지정 | **이번 범위 제외.** 모든 모임은 공식 편성(`daily_readings`)을 읽는다. `group_ranges` 테이블·`range_mode`·범위 API·관련 테스트/UI 없음. `AC-024-05` 의 리더 지정은 후속 |
| D2 | 모임 설정 화면(`SCR-PWA-021`) | **기본 5가지** — 모임 이름 변경 · 식구 목록(전체 인원 수는 여기서만) · 초대 코드 새로 만들기 · 식구 내보내기 · 나가기/모임 삭제. 리더 넘기기(수동 위임)는 후속. 계정 삭제 시 가장 먼저 들어온 식구에게 리더 자동 이전은 유지 |
| D3 | 개통 | **베타 테스터에게 바로 켠다.** `NEXT_PUBLIC_HOONDOK_TOGETHER` 는 킬 스위치로만 두고 배포에서 ON. 약관(`DEC-PWA-001`)·14세 미만 정책 미확정 상태의 개통을 사용자가 결정했다 — 약관 확정 시 모임 공개 안내·동의 문구를 다시 본다 `[확인 필요]` |
| D4 | 베타 게이트 | **유효한 모임 초대 코드가 전역 `HOONDOK_INVITE_CODE` 게이트를 대신 통과한다** (가입 `API-HD-002` 의 `invite_code` 에 모임 코드를 넣어도 된다) |
| D5 | 기존 결정 유지 | 익명 숫자 임계 10명 · 전체 인원은 식구 목록에서만 · 반응 수는 내 한 줄에만·나에게만 · 완료자만 보임 · 한 줄 100자 + 반응 1종 "함께 머물렀어요" |
| D6 | 초안 기본값 채택 | 한 줄은 오늘 훈독(`read`) 완료자만 · 한 줄 화면은 오늘 것만, 30일 뒤 삭제(정리 스크립트는 후속) · 초대 코드 30일 만료 + 재발급 · 한도 정원 50 / 가입 5 / 리더 3 / 모임 정성 3 · 공식 정성은 모든 모임에 자동 표시 · admin 모임 목록 + 삭제 포함 · 챌린지 셸 사람 행 반응 버튼 제거 |
| D7 | 문구 | "새벽" 을 쓰지 않는다(1단계와 같음). 모임 카드는 "{모임} · 오늘 N명이 함께 읽었어요" |

## 2. 확인된 사실 (설계 근거)

| 항목 | 사실 | 근거 |
|---|---|---|
| 미션 완료 | `MissionLog(user_id, mission_date KST, kind, completed_at UTC naive)`, unique `(user_id, mission_date, kind)` → 행 수 = 사람 수 | `apps/api/app/modules/hoondok/models.py` |
| 개인 정성 | `JeongseongPeriod` 는 `user_id NOT NULL`·사용자당 active 1건·`Literal[7,21,40]` — 공동 정성을 끼우면 `JeongseongService`·`JourneyService.today` 가 흔들린다 → 확장하지 않고 새 테이블 | `models.py`, `journey_service.py` |
| 오늘 말씀 | `DailyReading.reading_date` unique, 편성 admin API 는 daily_readings 만(공식 정성 API 없음) | `admin_router.py` |
| admin 블록 | `/admin/hoondok/...`, 라우터 레벨 `verify_csrf`, `_ADMIN_GATE`, 변경 시 `log_audit` | `admin_router.py`, `app/main.py` |
| 사용자 인증 | 쿠키 `hoondok_token`, `get_current_user`(401), `verify_csrf` = `X-Requested-With` | `identity/dependencies.py` |
| 계정 삭제 | `get_user_data_purgers` 가 `delete_for_user` 리포 목록을 주입, 커밋 1회 | `identity/dependencies.py`, `identity/service.py` |
| 전역 초대 코드 | `check_invite_code`(상수 시간 비교, 403 `INVITE_REQUIRED`), `SignupRequest.invite_code` 선택 필드 | `identity/service.py`, `identity/schemas.py` |
| 동의 | `users.consented_at`·`consent_version` NULL 예약, `DEC-PWA-001` 문서 0건 | `identity/models.py`, `docs/TODO.md` Blocked |
| 규칙 | PG ENUM 금지(varchar + Literal), `ondelete` 없이 리포 명시 삭제, 날짜 KST(`today_kst()`)·타임스탬프 naive UTC, rate limit 은 인메모리 `RateLimiter` | `models.py`, `core/common/clock.py`, `safety/rate_limiter.py` |
| web | 화면 레지스트리 `HOONDOK_SCREENS`, 오류 경로 allowlist `observability/report.ts`, CSS 는 `layout.tsx` 고정 import + `hoondok:check`(토큰 밖 hex 0) | `features/hoondok/screens.ts`, `layout.tsx`, `tooling/checks/hoondok-css.mjs` |
| DEC-PWA-023 위반 잔여 | 가족 셸 "오늘 완료/아직" 배지, 챌린지 셸 "아직"·응원, fixture "우리 교회 40일 정성", 정성 카드·정원 "밀린 날", 홈 미션 "가족·교회", 설정 "우리 교회와 앱 소식" | `family-screen.tsx`, `challenge-detail.tsx`, `preview/fixtures/worship.ts`, `jeongseong-card.tsx`, `garden-screen.tsx`, `jeongseong-form.tsx`, `home-missions.tsx`, `settings-screen.tsx` |

## 3. 데이터 모델 (alembic 1개, `down_revision = "q2b3c4d5e6f7"`)

재사용: 모임 완료자 = `mission_logs` 의 `kind='read' AND mission_date = today_kst() AND user_id IN (모임원)`(1단계 인덱스 + 기존 unique 가 받는다), 완료 시각 = `completed_at` → KST, 오늘 범위 = `daily_readings`. 신규 5테이블:

| ID | 테이블 | 열 | 제약·인덱스 |
|---|---|---|---|
| `ENT-HD-013` | `reading_groups` | `id` uuid · `name` varchar(20) · `kind` varchar(16) `small_group`(가족은 후속) · `meeting_time` time NULL(표시용) · `invite_code` varchar(16) · `invite_expires_at` · `created_at`·`updated_at` | `invite_code` unique. 모임당 유효 코드 1개, 재발급 = 덮어쓰기(이전 코드 즉시 무효) |
| `ENT-HD-014` | `group_members` | `id` · `group_id` FK · `user_id` FK · `display_name` varchar(12) · `role` varchar(16) `leader\|member` · `joined_at` | unique `(group_id, user_id)` · unique `(group_id, display_name)` · 부분 unique 리더 1명(`postgresql_where`+`sqlite_where`, `jeongseong_periods` 패턴) · index `user_id`. 탈퇴 = 행 하드 삭제 |
| `ENT-HD-015` | `shared_jeongseongs` | `id` · `group_id` FK **NULL**(NULL = 공식) · `title` varchar(40) · `started_on` date · `duration_days` int(1~100) · `source_note` varchar(200) NULL · `created_by_user_id` FK NULL · 타임스탬프 | index `group_id`. 진행은 저장하지 않고 `day_index = (today - started_on).days + 1` |
| `ENT-HD-016` | `group_shares` | `id` · `group_id` FK · `member_id` FK · `share_date` date · `body` varchar(100) · 타임스탬프 | unique `(group_id, member_id, share_date)` = 1인 1일 1줄(덮어쓰기) · index `(group_id, share_date)` |
| `ENT-HD-017` | `share_reactions` | `share_id` FK · `member_id` FK · `created_at` | PK `(share_id, member_id)`, 종류 컬럼 없음 |

모델은 `models.py` 끝에 5클래스 + 상수 `GROUP_KINDS`·`GROUP_ROLES`.

## 4. API (`API-HD-030~043`)

공통: prefix `/hoondok`, 쿠키 `hoondok_token`, 변경은 `verify_csrf`, 오류 `{"detail": ...}`. **비모임원에게는 모임 존재를 알리지 않도록 404.** 새 파일 `groups_{router,service,repository,schemas}.py`, admin 은 `groups_admin_router.py`.

| ID | 메서드·경로 | 권한 | 요약 |
|---|---|---|---|
| `API-HD-030` | GET `/hoondok/me/groups` | 로그인 | `[{id, name, kind, role, my_display_name, today_read_count, readers_preview(이니셜 ≤3), jeongseongs[{title, day_index, duration_days, is_official}]}]`, 0건 `[]` |
| `API-HD-031` | POST `/hoondok/groups` | 로그인+CSRF | `{name, display_name, meeting_time?, jeongseong?{title, duration_days, started_on}}` → 201 상세 + `invite_code`. 409 리더 한도 · 422 |
| `API-HD-032` | GET `/hoondok/groups/{id}` | 모임원 | 머리(name·kind·리더 표시 이름·meeting_time) · `today_reading`(daily_reading 요약 + 원문 링크, 없으면 null) · `jeongseongs`(진행 중 공식 + 모임) · `readers`(오늘 완료자만, 가나다순 `{display_name, read_at_kst, is_me, is_leader}`) · `shares`(오늘 것만) · `me` · `invite_code`·`invite_expires_at`(리더에게만). 전체 인원 없음 |
| `API-HD-033` | PATCH · DELETE `/hoondok/groups/{id}` | 리더+CSRF | PATCH `{name}` · DELETE = 모임 하드 삭제 204 |
| `API-HD-034` | POST `/hoondok/groups/{id}/invite` | 리더+CSRF | 재발급 → `{invite_code, invite_expires_at}`, 이전 코드 즉시 무효 |
| `API-HD-035` | GET `/hoondok/invites/{code}` | 로그인 + 초대 limiter | 미리보기 `{name, kind, leader_display_name, jeongseongs[]}`(전체 인원 없음). 잘못·만료·정원 초과는 같은 404. 이미 모임원이면 `is_member=true` + `group_id` |
| `API-HD-036` | POST `/hoondok/invites/{code}/join` | 로그인+CSRF + limiter | `{display_name}` → 201 `{group_id}`. 404 무효 · 409 이미 모임원 / 이름 중복 / 정원 / 가입 한도 |
| `API-HD-037` | PATCH · DELETE `/hoondok/groups/{id}/me` | 모임원+CSRF | PATCH `{display_name}`(중복 409) · DELETE 탈퇴(내 한 줄·내 반응·내 한 줄에 달린 반응 삭제). 리더는 다른 식구가 있으면 409 `LEADER_MUST_HANDOVER`, 혼자면 모임 삭제 |
| `API-HD-038` | GET `/hoondok/groups/{id}/members` · DELETE `/.../members/{member_id}` | 리더(+CSRF) | 목록 `{member_count, items[{id, display_name, role, joined_at}]}` — **읽음 상태 없음, 전체 인원은 여기만**. DELETE 내보내기(탈퇴와 같은 삭제), 자기 자신 409 |
| `API-HD-039` | POST `/hoondok/groups/{id}/jeongseongs` · DELETE `/.../jeongseongs/{jid}` | 리더+CSRF | `{title(≤24), duration_days(1~100), started_on(오늘±30)}` → 201. 진행 중 모임 정성 ≤3. 수정 API 없음 |
| `API-HD-040` | PUT `/hoondok/groups/{id}/shares/today` · DELETE `/.../shares/{share_id}` | 모임원+CSRF | PUT `{body(1~100, 공백·줄바꿈 정리)}` upsert, 오늘 read 미완료면 409 `READ_REQUIRED`. DELETE 는 작성자 또는 리더 |
| `API-HD-041` | PUT · DELETE `/hoondok/groups/{id}/shares/{share_id}/reaction` | 모임원+CSRF | "함께 머물렀어요" 토글 `{has_reacted}`. 자기 한 줄 409, 알림 없음 |
| `API-HD-042` | GET · POST `/admin/hoondok/jeongseongs` · PUT · DELETE `/.../{id}` | admin 게이트+CSRF | 공식 정성(`group_id IS NULL`) CRUD `{title(≤40), started_on, duration_days, source_note?}`, 감사 로그 `official_jeongseong.*` |
| `API-HD-043` | GET `/admin/hoondok/groups` · DELETE `/.../{id}` | admin 게이트+CSRF | 목록 `id·name·member_count·created_at` 만(모임원 이름·한 줄 비노출). DELETE 신고 대응 + 감사 로그 |

- `shares[]` 항목 `{id, display_name, body, created_at_kst, is_mine, has_my_reaction, reaction_count}` — `reaction_count` 는 `is_mine` 일 때만 값, 남의 한 줄은 null. 반응한 사람 목록은 누구에게도 주지 않는다.
- **D4 베타 게이트 (기존 `API-HD-002` 변경, 새 ID 없음)**: `check_invite_code` 가 전역 코드 불일치 시 `invite_code` 를 모임 코드로 정규화해 유효(존재·미만료·정원 미달)하면 통과시킨다. identity 는 hoondok 모듈을 직접 import 하지 않고 `InviteCodeVerifier` 프로토콜을 의존성으로 주입받는다. 가입만 통과시키고 모임 참여는 따로 `API-HD-036` 을 부른다. `[가정]` 참여 링크 → 온보딩 `returnTo` 에서 `code` 를 읽어 가입 폼 초대 코드 칸을 미리 채운다.

## 5. 개인정보·안전

- 어떤 모임원 응답에도 미완료자 목록·수·상태를 넣지 않는다. 전체 인원은 `API-HD-038`(리더) 과 admin 목록에만. 작은 모임에서 "아는 사람 중 목록에 없는 사람" 추론은 구조상 못 막는다 — 공개 안내가 이를 전제로 쓴다 `[가정]`.
- 한 줄은 오늘 완료자만(D6) — 미완료자 한 줄이 읽음 목록과 어긋나 미완료를 드러내지 않게.
- 초대 코드: Crockford base32 8자 `XXXX-XXXX`(40bit, `secrets`), 대소문자·하이픈 무시 정규화, 이름 접두 없음. 초대 limiter `RateLimiter(10, 60)` IP 기준(`API-HD-035·036`, 가입 경로의 모임 코드 검증도 같은 limiter) `[가정]` 인메모리·단일 워커 전제.
- 모임 이름은 별칭(≤20), 교회명 필드·검색·공개 목록 없음.
- 삭제: 탈퇴·내보내기 = `group_members` + 그 사람 `group_shares` + 누른 반응 + 그 사람 한 줄에 달린 반응. 모임 삭제 = `share_reactions → group_shares → shared_jeongseongs(group) → group_members → reading_groups`. 계정 삭제(`API-HD-011`) = `GroupRepository.delete_for_user` 를 purger 에 등록, 리더인 모임은 가장 먼저 들어온 식구에게 이전, 없으면 모임 삭제.
- 신고·차단은 범위 밖. 대응 수단은 리더의 한 줄 삭제·내보내기 + admin 모임 삭제.
- 14세 미만·동의: 계정에 나이 정보가 없다. 참여 화면의 "모임에 보이는 것" 안내가 고지이며 `joined_at` 이 확인 시각 `[가정]`. D3 로 약관 전 개통 — 위험은 `docs/TODO.md` 에 남긴다.

## 6. web (`apps/web`)

| 라우트 | 화면 | 비고 |
|---|---|---|
| `/hoondok/groups/new` | `SCR-PWA-019` 만들기 → 코드·공유 | 오늘 범위 선택 없음(D1) |
| `/hoondok/groups/join?code=` | `SCR-PWA-018` 참여 | 비로그인은 `onboardingHref(경로+쿼리)` |
| `/hoondok/groups/[id]` | `SCR-PWA-017` 상세 | 머리에 인원 없음 |
| `/hoondok/groups/[id]/share` | `SCR-PWA-020` 한 줄 쓰기 | |
| `/hoondok/groups/[id]/settings` | `SCR-PWA-021` 설정 | 리더 5가지 / 모임원 이름·나가기, 되돌릴 수 없는 동작은 인라인 확인(프로토타입 `tg-confirm`) |

- 모두 "오늘 훈독" 탭 귀속, `screens.ts` 등록, `report.ts` allowlist 에 `/hoondok/groups/:id` 류 정규화 추가.
- 초대 공유는 `navigator.share` → 미지원이면 클립보드. 카카오 SDK 없음, 공유 텍스트는 모임 이름·링크만.
- feature: 1단계 `features/hoondok/together/` 에 `groups-api.ts` · `invite-code.ts` · `use-groups.ts` · `components/group-*.tsx` 를 더한다. 쿼리키 `MY_GROUPS_KEY`·`groupKey(id)`·`groupMembersKey(id)`, 미션 완료 무효화에 `["hoondok","groups"]` 를 더한다(`PROGRESS_KEYS` 에 추가).
- 홈: 1단계 `TogetherCard` 아래에 모임 카드(최대 5) 또는 진입 카드("모임 만들기 / 초대 코드로 참여" + "가족 모임은 곧 열려요"). 완료자 0명이면 숫자 없이 모임 이름만. 훈독 완료 뒤: 1단계 `TogetherDoneNotice` 아래 "{첫 모임}에 한 줄 남기기"(서버 완료 확정 시에만).
- 정정(§2 마지막 행): "밀린 날" → "N일차"(API `missed_days` 는 유지, 화면만), 가족·챌린지 셸의 "아직"·응원·교회 챌린지·사람 행 반응 버튼 제거, 정원 가족 절 → "함께 읽는 사람들", 문구 2곳("가족·모임 기도 제목", "앱 소식"). 설교의 교회장·교회명은 콘텐츠 출처 표기라 유지 `[가정]`.
- 플래그: 새 빌드 플래그 `NEXT_PUBLIC_HOONDOK_TOGETHER`(Dockerfile·`deploy-web` 배선). **킬 스위치**다 — 배포는 ON(D3), 문제 시 OFF 재빌드로 `/hoondok/groups/**` 404·카드 미렌더. 정정 문구는 플래그와 무관. 백엔드 라우트는 항상 등록.
- CSS: 1단계 `app/_hoondok/together.css` 에 프로토타입 `hoondok.css` §13 나머지 `tg-*`(폼·설정·확인 카드) 이식, 새 토큰·hex 0.

## 7. admin (`apps/admin`)

- 신설 `/hoondok/jeongseongs`: 공식 정성 목록(진행 중·예정·끝남) + 등록/수정/삭제, nav "공식 정성". 기존 `daily-reading-form.tsx` 패턴.
- 신설 `/hoondok/groups`: 목록(이름·인원·생성일) + 삭제 확인. 모임원 이름·한 줄 본문 비노출.

## 8. 트랙 분해 (오케스트레이터 모드, `dev/hoondok-groups`)

순서 **A → W0 → (W1 ∥ W2 ∥ C) → 통합**. 공유 파일(`main.py`·`models.py`·`query-keys.ts`·`layout.tsx`·`together.css`·`playwright.config.ts`·`hoondok.css` 토큰·`components/hoondok/*`·`tabs.ts`)은 지정 트랙만 편집한다.

| 트랙 | 소유 파일 | 의존 | 완료 기준 |
|---|---|---|---|
| **A 백엔드** | `apps/api/app/modules/hoondok/models.py` · `alembic/versions/*_add_hoondok_groups.py` · 신규 `groups_{router,service,repository,schemas}.py`·`groups_admin_router.py` · `hoondok/dependencies.py` · `identity/{service,dependencies}.py`(모임 코드 검증 주입·purger) · `app/main.py` · `apps/api/tests/test_hoondok_groups*.py`·`test_hoondok_official_jeongseong.py`·`test_identity_auth.py`(모임 코드 게이트 추가분) · `contracts/openapi.json` · `packages/api-client-ts/src/generated/**` · `docs/specs/api/hoondok-api.md` · `docs/specs/domain/hoondok-entities.md` | #317·#318 | §9 pytest · 기존 기준선 이상 · `contracts:check` 추가만 · alembic upgrade/downgrade 왕복 |
| **W0 web 기반** | `features/hoondok/query-keys.ts` · `use-missions.ts` · `flag.ts` · `screens.ts` · `observability/report.ts` · `app/_hoondok/together.css` · `features/hoondok/together/{groups-api,invite-code,use-groups}.ts` · `features/identity/`(가입 폼 코드 미리 채움) · `tests/e2e/playwright.config.ts` · `apps/web/Dockerfile`·`Makefile`(플래그 배선) | A 계약 | Vitest(경로·CSRF·키 무효화·코드 정규화) · `hoondok:check` · typecheck |
| **W1 모임 화면** | `app/(hoondok)/hoondok/groups/**` · `together/components/group-{detail,join-form,create-form,share-form,settings}.tsx` · `src/test/hoondok-groups*.test.tsx` · `tests/e2e/hoondok-groups.spec.ts` | W0 | §9 Vitest · E2E 왕복 · 390/768/1280 가로 스크롤 0 |
| **W2 홈·완료 뒤·정정** | `app/(hoondok)/hoondok/page.tsx` · `together/components/{group-card,group-entry-card,group-list}.tsx` · `together/components/together-card.tsx`(완료 뒤 한 줄 진입) · `components/read-complete-button.tsx` · `components/home-missions.tsx` · `jeongseong/components/{jeongseong-card,jeongseong-form}.tsx` · `garden/components/garden-screen.tsx` · `family/components/family-screen.tsx` · `worship/components/challenge-detail.tsx` · `preview/fixtures/{family,worship}.ts` · `settings/components/settings-screen.tsx` · 관련 기존 Vitest · `tests/e2e/hoondok-{preview,garden,jeongseong}.spec.ts` 문구 | W0 | Vitest · "아직"·"응원"·"밀린 날"·"우리 교회" 0건(설교 제외) · 기존 E2E 통과 |
| **C admin** | `apps/admin/src/app/(dashboard)/hoondok/{jeongseongs,groups}/**` · `apps/admin/src/features/hoondok/{jeongseong,groups}-*.ts`·관련 컴포넌트 · `apps/admin/src/app/(dashboard)/layout.tsx`(nav 2줄) · admin Vitest · `tests/e2e/hoondok-curation.spec.ts`(공식 정성 절) | A 계약 | 등록→목록→수정→삭제 · 감사 로그 · 401/403 |
| **통합** (오케스트레이터) | 머지·게이트·이 문서 진행표 · `docs/TODO.md` · `docs/README.md` | 전부 | `make ci` · `make e2e`(기존 + 신규) · 독립 리뷰 ≤2 · 로컬 라이브 두 계정 |

### 8.1 진행표 (트랙이 끝날 때마다 먼저 갱신)

| 트랙 | 상태 | PR / 커밋 |
|---|---|---|
| A 백엔드 | 완료 (로컬 커밋 f8977cb · 0281f80, 브랜치 `feat/hoondok-groups-api`) — pytest 1287 passed · alembic 왕복 · contracts:check 통과 | 미푸시 |
| W0 web 기반 | 완료 (로컬 커밋 `893d01d`, 브랜치 `feat/hoondok-groups-web-base`) — Vitest 373(신규 36) · typecheck · lint · `hoondok:check` 통과. 플래그 `NEXT_PUBLIC_HOONDOK_TOGETHER` 미설정 = OFF, Dockerfile·`deploy-web HOONDOK_TOGETHER`(기본 1)·Playwright·`.env.example` = 1. W1 은 비로그인 참여 시 `onboardingHref(경로+쿼리)` 로 넘겨야 초대 코드가 미리 채워진다 | 미푸시 |
| W1 모임 화면 | 완료 — 5라우트·Vitest 40·E2E 두 계정 왕복 | `061cc81` |
| W2 홈·완료 뒤·정정 | 완료 — W2a 정정 + W2b 홈 카드·완료 뒤 진입, Vitest 389 | W2a `dbfb958` · W2b `69b1a2d` |
| C admin | 완료 — admin Vitest 163(신규 36) · typecheck·lint 통과 | `42f5ec9` |
| 통합 | 진행 중 — make ci EXIT 0 (pytest 1287 · web 429 · admin 163) · make e2e 98 passed · Playwright QA 진행 중 | — |

## 9. 테스트 계획

**pytest (A)**
- 생성·초대: 리더 1명 · 코드 형식 `^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$` · 소문자·하이픈 없는 입력 정규화 · 만료 404 · 재발급 뒤 이전 코드 404 · 정원·가입·리더 한도 409 · 이름 중복 409 · 이미 모임원 409 · limiter 11번째 429.
- 베타 게이트(D4): 전역 코드 설정 + 유효 모임 코드로 가입 201 · 만료/무효 모임 코드 403 `INVITE_REQUIRED` · 전역 미설정이면 기존대로 무시.
- 완료자만: 모임원 3명 중 1명 완료 → `readers` 1건, 상세·미리보기·내 모임 응답 직렬화 문자열에 나머지 이름·user_id·member_count 없음 · `read_at_kst` · 가나다순.
- 권한: 비모임원 404 · 모임원이 리더 전용(PATCH·invite·members·jeongseongs) 403 · 초대 코드는 리더 응답에만 · CSRF 없음 403 · 비로그인 401.
- 식구 목록: `member_count` 와 이름·역할·joined_at 만, 읽음 필드 없음 · 자기 내보내기 409.
- 한 줄·반응: 미완료자 409 · 101자 422 · 1일 1줄 upsert · 작성자·리더 삭제, 다른 모임원 403 · 반응 멱등 · 자기 한 줄 409 · `reaction_count` 작성자 본인만 · 어제 한 줄 없음.
- 탈퇴·삭제: 즉시 `readers`·`shares` 에서 사라짐 · 리더 탈퇴 409 / 혼자면 모임 삭제 · 모임 삭제 하위 0행 · 계정 삭제 purger + 리더 자동 이전(가장 먼저 들어온 식구).
- 정성: 공식은 모든 모임 상세에 · `day_index`(시작 전 예정, 끝난 뒤 제외) · 모임 정성 3개 한도 · admin CRUD·감사 로그·비게이트 403.
- 마이그레이션: `alembic upgrade head` → `downgrade -1` 왕복(로컬 Postgres).

**Vitest** — W0: API 경로·메서드·`X-Requested-With`, 코드 정규화·링크, 완료 뒤 groups 키 무효화, 가입 폼 코드 미리 채움. W1: 만들기 페이로드(이름 20·표시 이름 12·정성 토글), 공유 폴백, `?code=` 자동 채움, 404·409 안내, 상세 완료자만·공개 안내, 반응 `aria-pressed`, 내 한 줄 "N명이 함께 머물렀어요 · 나에게만 보여요", 설정 리더/모임원 분기·확인 카드·리더 나가기 비활성. W2: 홈 모임 있음/없음, 비로그인 진입 returnTo, 완료 뒤 한 줄 진입, "N일차", 셸에 "아직"·응원 없음, 플래그 OFF 면 모임 요소 0. C: 폼 검증·상태 라벨.

**E2E** (`hoondok-groups.spec.ts`, `hoondok-chromium`) — A 가입 → 모임 만들기 → 코드 · B 새 컨텍스트 → `join?code=` → 참여 · B 훈독 완료 → 한 줄 · A 상세에 B 만(A 없음) → 반응 · A 홈 모임 카드 "오늘 1명이 함께 읽었어요" · A 설정에서 B 내보내기 → B·B 한 줄 사라짐. 함정은 기존 레시피(신규 가입 사용자·401 로그 제외, 잔존 서버).

## 10. 작업량 추정 `[가정]` (서브에이전트 opus, 리뷰·수정 1회 포함)

| 트랙 | 추정 |
|---|---|
| A 백엔드 (모델 5·마이그레이션 1·API 14·게이트 주입·purger·pytest 약 55건·계약·명세) | 1.3~1.7일 |
| W0 web 기반 | 0.4일 |
| W1 모임 화면 (5라우트) | 1.3일 |
| W2 홈·완료 뒤·정정 | 0.9일 |
| C admin | 0.5~0.7일 |
| 통합 | 0.5~1일 |
| **합계** | 임계 경로 A→W0→W1→통합 **약 4~5일**, 순차 합 약 5~6일 (초안 대비 범위 지정 제외 −0.5일, 1단계 재사용으로 W0·W2 소폭 감소) |

## 11. 운영 배포 (dev→main 머지 뒤, 단계마다 승인)

1. `make deploy-backend` — alembic 적용(라우트만 추가, web 미사용 상태). smoke: `GET /hoondok/me/groups` 401(비로그인) · `/health` 200.
2. `make deploy-admin` → 편성자가 공식 정성 1건 등록(협회 공지, 있을 때).
3. `make deploy-web` — `NEXT_PUBLIC_HOONDOK_TOGETHER=1`(D3). smoke: `/hoondok/groups/new` 200 · 두 계정 모임 왕복 · `smoke-web`.
4. 문제 시 web 을 플래그 OFF 로 재배포(킬 스위치). backend 되돌리기는 runbook 층 0(새 이미지로 `alembic downgrade` 먼저).

## 12. 후속 (이번 범위 밖)

리더 지정 오늘 범위(D1) · 리더 넘기기 수동 위임(D2) · 지난 한 줄 30일 정리 스크립트(D6) · 가족 모임 · 신고·차단 · 약관 확정 뒤 모임 안내·동의 재검토(D3).
