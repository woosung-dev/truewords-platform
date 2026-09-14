# 다음 세션 실행 계획 — D→A 순차 전략

- 문서 ID: `PLAN-NEXT-001`
- 작성일: 2026-09-14
- 상태: **착수 대기**
- 근거: [RSH-VIEW-001](../../research/2026-09-14-mobile-pc-view-strategy.md)
- 방법: 세션 4개 독립 설계 + 통합 검증 (에이전트 5)

---

## 0단계 — 착수 전 10분 (반드시 먼저)

통합 검증에서 가장 심각하게 지적된 문제다. **미커밋 3건에 대해 4개 세션이 서로 모순되는 지시를 갖고 있다.** 먼저 도는 세션이 뒤 세션의 선행 조건을 자동으로 깨뜨린다.

| 항목 | 처리 |
|---|---|
| `docs/research/2026-09-14-mobile-pc-view-strategy.md` | **S1 이 커밋한다** (S2·S3 계획서의 같은 지시는 무시) |
| `docs/design/2026-09-pc-chat/` | HTML 9개 **삭제**, `README.md` 만 `docs/archive/design-2026-09-pc-chat/` 로 이동 후 커밋 |
| `tooling/checks/docs-links.mjs` 수정 | **되돌린다** (`git checkout --`). 이 수정은 폐기 대상 시안의 `data-src` 오탐만 잠재우는 변경이었다 |

추가로 `make e2e` 1회를 돌려 **공통 기준선을 TODO 에 고정**한다. 현재 S2 는 "18 passed / 5 failed", S4 는 "admin 사전 결함 5건"으로 서로 다른 기준선을 인용하고 있어 회귀 판정이 흔들린다.

---

## 실행 순서

```
S1 (기기 계측) ─────────────── 병렬 가능, 언제든 시작
                               변경 파일이 전부 apps/api·apps/admin·contracts 라
                               웹 트랙과 겹치지 않는다

웹 트랙:  S2 (안전망) → S4 (데스크톱 하한) → S3 (부채 정리)
```

**S4 를 S3 보다 먼저** 두는 것이 통합 검증의 권고다. S4 의 프로덕션 델타는 실측 6줄이고 S3 가 옮기는 블록과 줄 범위가 겹치지 않는다. 반대 순서는 유일한 사용자 가시 개선을 1.4일 미루고 S4 의 측정을 갓 리팩터된 파일 위에서 다시 하게 만든다.

**절대 금지 조합**
- `S3 ∥ S4` — 같은 파일 4개 지점 충돌
- `S2 ∥ S4` — `tests/e2e/playwright.config.ts` 동일 라인

**소유권 고정**
- `playwright.config.ts` viewport 명시 → **S2 단독** (S4 계획서 5단계에서 제거)
- `docs/TODO.md` 편집 → 각 세션의 **마지막 커밋 1개**로 몰 것. 병렬 시 S1 의 문서 커밋은 웹 트랙 뒤로

---

## 계획서가 스스로 틀린 곳 (착수 전 반드시 반영)

### ① S3 의 "행동 보존 규칙"이 실제로 행동을 바꾼다

S3 계획서는 뷰의 전송 핸들러를 이렇게 쓰라고 지시한다:

```js
const q = input.trim(); if (!q || !chat.selectedBot) return; setInput(""); void chat.send(q);
```

**실측:** 현행 `page.tsx` 는 `sendingRef` 가드(341행)가 `setInput("")`(347행)보다 **앞서** return 한다. 입력 textarea 는 `disabled={!selectedBot}` 뿐이라 스트리밍 중에도 입력이 가능하고, 지금은 그때 친 글이 **보존된다**. 계획대로 하면 비우기가 가드보다 앞서 와서 질문을 소리 없이 삼킨다.

→ 행동 보존 리팩터링의 유일한 계약을 계획서가 위반했다. S2 의 안전망으로도 안 잡힌다. **S2 에 이 케이스를 테스트로 추가**한 뒤 S3 를 진행할 것.

### ② 계측 데이터를 *읽는* 시점이 어디에도 없다

S1 은 TODO 에 "4~8주 뒤 재판단" 한 줄만 남긴다. 목표 날짜도, 최소 표본 수도, 10%/30% 임계를 어떤 쿼리로 판정할지도 없다. **계측을 붙이는 이유가 "6개월 뒤에도 데이터 없이 같은 질문을 하지 않기"인데, 읽는 약속이 없으면 그 이유가 무효가 된다.**

→ S1 완료 시 TODO 에 **목표 날짜 2개(4주차 중간 점검 / 8주차 판정)와 최소 표본 기준, 판정 쿼리**를 함께 박을 것. 분모는 `measured_sessions`(unknown 제외)로 정의한다.

### ③ `device_class` 는 신규 세션에만 기록된다

`session.py::_get_or_create_session` 은 기존 세션을 그대로 반환하므로, `/history` 에서 "이어서 대화"로 진입한 세션은 기기가 바뀌어도 **최초 기기로 귀속**된다. 설계로는 옳지만 이 한계가 어디에도 문서화돼 있지 않다 → 이벤트 사전에 명시.

### ④ S4 의 `max-w-2xl` 줄 번호가 실제와 다르다

실측 4곳: **739**(빈 화면 컬럼) · **830**(메시지 리스트) · **997**(후속 질문 입력바) · **1054**(면책 footer). 계획서는 997 을 빠뜨리고 1057 을 잘못 지목했다.

### ⑤ S2 의 React Query mock 이 불완전해 첫 렌더가 죽는다

`page.tsx:1074` 의 `<SourceOriginalModal>` 은 **항상 마운트**되고 `source-original-modal.tsx:40` 에서 `useQuery` 를 조건 없이 호출한다 (`enabled` 는 fetch 만 막지 훅 호출은 못 막는다). mock 에 `useQuery` 를 반드시 포함할 것.

---

## 범위 침범 차단선

D→A 순차 전략을 깨뜨릴 위험이 가장 큰 지점들이다.

| 위험 | 차단선 |
|---|---|
| S4 "측정 패스"가 6개 지표를 재고 나면 skip link 신설·focus ring 보강·arbitrary px 23곳이 동시에 "미달"로 보인다. 판정 기준이 측정자 자신이다 | 수정 대상을 **착수 전에 목록으로 고정**하고, 측정에서 새로 발견된 것은 TODO 로만 보낸다 |
| `max-w` 토큰 선택이 정보구조 결정으로 번진다 (`max-w-4xl` 이면 `/history` 1180px·`/about` 과 "통일" 논의가 열린다) | **`max-w-3xl`(768px) 을 상한으로 선언.** 초과하면 이번 세션 범위 밖 |
| `web-viewport-chromium` 프로젝트 신설이 데스크톱 전용 테스트 레이어의 첫 삽이 된다 | spec 1개·프로젝트 1개 상한 + `toHaveScreenshot`/`toMatchSnapshot` **금지** |
| S2 의 "마지막 수단" mock 이 조용히 기본값이 된다 (`Select` → `Sheet` → `Popover` → 결국 페이지를 렌더하지 않은 테스트) | 허용 mock 을 **`select` 1개로 한정** |
| S1 의 admin 카드가 대시보드 손질로 번진다 | `FallbackDistribution`(`analytics/page.tsx:29~74`) 마크업 복제 외 **신규 CSS 클래스 0** |

---

## 세션별 시작 프롬프트

각 세션을 새 Claude Code 세션에서 시작할 때 **첫 메시지로 그대로 붙여넣는다.** 위 "계획서가 스스로 틀린 곳"의 해당 항목을 함께 전달할 것.


---

### S1 — 기기 계측 (device_class)

- **목표** `research_sessions.device_class`(mobile|tablet|desktop) 파생 컬럼과 admin 분포 카드를 한 PR로 붙여, 4~8주 뒤 D→A 전환을 판단할 기기 분포 데이터를 축적하기 시작한다.
- **브랜치/PR** 단일 기능 브랜치 `feat/device-class-instrumentation`, base=main, PR 1개. sub-task가 하나뿐이므로 3-tier 통합 브랜치(`dev/**`)는 쓰지 않는다 — 공유 파일 충돌 위험도 없다. 커밋은 5개로 분할(모델·마이그레이션 / 파이프라인 배선 / 집계·API·계약 / admin 카드 / 문서)해 리뷰 시 계약 재생성 diff를 격리한다. main 직접 커밋·푸시 금지. free private 레포라 required check 강제력이 0이므로 `gh pr merge --auto` 를 쓰지 말고 `gh pr checks <PR#> --watch` 로 CI 통과를 확인한 뒤 **수동 squash 머지**한다. 머지 후 배포는 backend → admin 순(`make deploy-backend` → `make deploy-admin`), `deploy-guard`(HEAD ∈ origin/main + 클린 트리) 통과 필요. 커밋·푸시·PR·머지·배포 각 단계마다 사용자 승인을 받는다.
- **공수** **0.75~1일 (6~8시간).** 내역: 트리 정리·브랜치 0.3h / 모델·마이그레이션 0.5h / 파서·의존성·파이프라인 배선 + e2e 하네스 1.0h / 테스트 12~14케이스 1.0h / 집계·스키마·라우터 0.8h / 계약·SDK 재생성 0.4h / admin 카드 0.8h / 문서 5건 1.2h / 로컬 검증(`make ci` 8~12분 + DB 왕복 + UA 프록시 프로브) 1.0h / PR·머지·배포 0.8h ≈ 7.8h.

**시작 프롬프트**

```
TrueWords 플랫폼(`/Users/woosung/project/agy-project/truewords-platform`, main) 세션 S1 — 기기 계측.

[배경] 2026-09-14 "D→A 순차" 승인. PC 전용 뷰를 지금 만들지 않고 기기 분포를 먼저 계측해 4~8주 뒤 재판단한다. 근거는 `docs/research/2026-09-14-mobile-pc-view-strategy.md` §5 단계 0(미추적 파일 — 이번 PR에 포함). PC 시안 `docs/design/2026-09-pc-chat/`는 폐기, 커밋 금지.

[목표] `research_sessions.device_class`(mobile|tablet|desktop, nullable VARCHAR(16)) 추가 → 집계 쿼리 → admin 분포 카드까지 한 PR.

[제약]
- UA 원문 저장 금지, 파생값만. 파싱은 chat 라우터 의존성(`apps/api/app/modules/chat/dependencies.py:116 get_optional_user_id` 패턴), 순수 함수는 신규 `chat/device.py`. 미들웨어·파이프라인 스테이지 아님.
- 미사용 `client_fingerprint`는 재활용도 삭제도 하지 않는다(의미가 다름).
- alembic 현재 단일 head `a1c9e7d0b2f3`. 이를 down_revision 으로 쓰고 `uv run alembic heads`가 1줄인지 확인(Dockerfile이 `alembic heads|head -1`로 EXPECTED_HEAD를 굽는다).
- 집계는 `admin/analytics_repository.py`(`get_daily_modes`:67 패턴) 쿼리 1개 + `analytics_schemas.py` + `analytics_router.py`. 경로는 `/admin/analytics/devices/distribution` — `/sessions/{session_id}`가 먼저 매칭돼 422 나므로 `/sessions/...` 금지.
- NULL은 집계에서 빼지 말고 `unknown`(미상) 버킷으로 남기고, `measured_sessions`(미상 제외 분모)를 따로 노출한다.
- DTO/SDK는 `pnpm contracts:generate`로만 생성, 생성물 직접 편집 금지.
- `apps/api/tests/e2e_app.py`의 `FixtureChatService`가 `process_chat`/`process_chat_stream`을 오버라이드하니 시그니처를 함께 고쳐야 `make e2e`가 안 깨진다.
- 단계 1~3(테스트 안전망, `useChatSession` 추출, 데스크톱 레이아웃)은 전부 범위 밖. `apps/web` 변경 0건.

[완료] 신규 pytest 통과, `pnpm contracts:check`·`make ci` 통과, admin `/analytics`에 분포 카드, 이벤트 사전 문서(목적·속성·보존 기간·접근 역할) 신규 작성. main 직접 푸시 금지 — 기능 브랜치+PR, 커밋/푸시/머지/배포 각각 사용자 승인.

먼저 위 research 문서와 `apps/api/app/modules/chat/pipeline/stages/session.py`를 읽고 계획을 브리핑한 뒤 착수하라.
```

**이 세션에서 하지 않을 것**

- **PC 전용 UI 일체** — 3-pane 정보구조, 데스크톱 breakpoint 도입, 세션 레일, 근거 패널, 호버 프리뷰. D→A 순차 결정의 핵심이 '계측 데이터 없이 PC UI를 만들지 않는다' 이므로 이번 세션의 어떤 코드도 `apps/web` 의 레이아웃을 바꾸지 않는다
- **단계 1 (안전망)** — `(chat)/page.tsx` 렌더 테스트 4경로(스트리밍 누적/abort/placeholder dedupe/세션 하이드레이션) 추가. 별도 세션
- **단계 2 (부채 정리)** — `useChatSession()` 추출(360~400줄), `stripDisclaimer` 중복 제거(`page.tsx:91` + `history/page.tsx:45`), `lib/reactions-api.ts` dead code 삭제. 전부 별도 세션
- **단계 3 (데스크톱 하한)** — `max-w-2xl` 조정, 여백 정리, `AC-PWA-014-01` 가로 스크롤 대응. 별도 세션
- **`tests/e2e/playwright.config.ts` 의 `viewport` 명시** — 데스크톱 breakpoint 를 도입할 때 필요한 선행 작업이다. 이번 PR 은 프론트 레이아웃을 안 바꾸므로 기존 E2E 에 영향이 없고, 지금 손대면 무관한 회귀 위험만 생긴다
- **`(chat)/page.tsx:173·180` 의 `resumedRef` 기존 결함**(레일/목록에서 두 번째 세션 로드 실패) — 실재하는 버그지만 계측과 무관. 발견 사실만 TODO 에 남기고 고치지 않는다
- **`client_fingerprint` 컬럼 재활용·삭제·백필** — 의미가 다르다. 컬럼 drop 은 레포 규칙상 2단계 배포 대상
- **UA 원문·IP·브라우저/OS 세분·해상도·뷰포트 수집**, 프론트 텔레메트리 SDK(GA/PostHog 등) 도입, 세션 단위를 넘는 사용자 추적. 개인정보 조항 위반

**완료 기준 (발췌)**

- `cd apps/api && uv run alembic heads` 출력이 1줄(신규 revision 단독 head)이고, `uv run alembic upgrade head` → `downgrade -1` → `upgrade head` 왕복이 오류 없이 끝난다
- 로컬 compose Postgres에서 `psql -c "\d research_sessions"` 가 `device_class | character varying(16) | nullable` 을 보여준다
- GEMINI_API_KEY를 일부러 무효화한 상태로 `curl -H 'User-Agent: Mozilla/5.0 (iPhone; ...)' -X POST localhost:8000/chat` 을 보내면 응답은 5xx여도 `SELECT device_class, count(*) FROM research_sessions GROUP BY 1` 에 `mobile` 행이 1 증가한다 (SessionStage가 EmbeddingStage보다 먼저 실행되므로 LLM 호출 없이 검증 가능)
- `GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen pytest -q` 가 전부 통과하고, 신규 테스트 3파일(UA 파서 / SessionStage device_class 기록 / analytics devices 엔드포인트)이 포함된다
- `pnpm contracts:check` 통과 — `contracts/openapi.json` 과 `packages/api-client-ts/src/generated/` 가 재생성 결과와 byte 일치하고 oasdiff breaking 0건(엔드포인트 추가는 additive)
- `pnpm --filter @truewords/admin test typecheck lint build` 통과, `pnpm dev:admin` 으로 `/analytics` 진입 시 '기기 분포' 카드에 mobile/tablet/desktop/미상 4행과 각 비율, '측정 세션(미상 제외)' 분모가 노출된다

---

### S2 — 안전망 — (chat)/page.tsx 렌더 테스트

- **목표** `apps/web/src/app/(chat)/page.tsx`(1217줄)의 4개 핵심 경로(스트리밍 누적 / abort 중단 / placeholder dedupe / 세션 하이드레이션)를 프로덕션 코드 무수정으로 Vitest 안전망에 가두고, `tests/e2e/playwright.config.ts` 의 암묵 viewport 를 명시 고정해 이후 리팩터링·breakpoint 작업의 회귀 기준선을 만든다.
- **브랜치/PR** **단일 브랜치 + 단일 PR.** 브랜치 `test/chat-page-safety-net`(프로젝트 규칙 `{type}/{짧은-설명}`), base `main`.

3-tier 통합 브랜치(`dev/**` + sub-task PR)는 쓰지 않는다 — 관심사가 하나이고 변경 파일이 5개 이하(신규 테스트 1 + setup.ts 폴리필 옵션 + playwright.config.ts 1줄 + 문서 3)라 분할 이득이 0이다. `.claude/CLAUDE.md` 의 3-tier 규정은 "여러 sub-task 가 묶이는 큰 작업" 조건부다.

커밋 4~5개(`docs:` 조사 문서 → `test(web):` 안전망 → `chore(e2e):` viewport → `docs:` 계획·TODO). 브랜치 위 일반 커밋은 기록된 사용자 선호(2026-04-25)에 따라 자율 진행, **push·`gh pr create`·머지는 각각 명시 승인**.

머지 전략: free private 레포라 branch protection 강제력이 0이므로 `--auto` 를 쓰지 않고 `gh pr checks <PR#> --watch` 로 CI green 확인 후 **수동 squash merge**. `--delete-branch` 는 현재 체크아웃된 worktree 를 지우는 알려진 함정이 있으므로 브랜치 삭제는 머지 후 main 으로 이동한 뒤 별도 실행.

**배포 없음.** `make deploy-*` 는 호출하지 않는다 — 테스트 파일·Playwright 설정은 런타임 이미지 동작을 바꾸지 않고, `apps/web/Dockerfile` 의 ARG 3개(`NEXT_PUBLIC_API_URL`/`WEB_URL`/`ADMIN_URL`)도 건드리지 않는다.
- **공수** **약 7시간 ≈ 1 사람-일.** RSH-VIEW-001 §5 의 "단계 1 — 약 1일" 추정과 일치하며, 아래는 실측 근거에서 역산한 내역이다.

**시작 프롬프트**

```
TrueWords(`/Users/woosung/project/agy-project/truewords-platform`) **S2 — 채팅 화면 안전망 테스트** 세션이다.

배경: `apps/web/src/app/(chat)/page.tsx`(1217줄)를 렌더하는 Vitest 가 0개다. 다음 세션에서 `useChatSession()` 을 추출하므로 그 전에 안전망을 깐다. **리팩터링이 아니라 전제조건이다 — 프로덕션 코드는 한 줄도 고치지 않는다.**

목표: `apps/web/src/test/chat-page.test.tsx` 1개 파일로 4경로를 잠근다 — 스트리밍 누적 / abort 중단 / placeholder dedupe(동기 `sendingRef` 가드) / 세션 하이드레이션(`?session=`). 더해 `tests/e2e/playwright.config.ts:16` 의 `use` 에 `viewport:{width:1280,height:720}` 만 명시해 현재 암묵 기본값을 고정한다.

제약
- 이음매는 **global `fetch` 스텁**이다. `@/features/chatbot/chat-api` 와 `@/lib/sse` 는 모킹 금지(다음 세션이 옮길 모듈). 어서션은 DOM 접근성 이름·텍스트와 fetch 호출 로그/요청 body 만.
- 컨벤션은 기존 것을 그대로 따른다: `src/test/login.test.tsx`(next/navigation·react-query mock 배치), `src/test/chat-stream.test.ts`(ReadableStream Response 헬퍼).
- 참여자 게이트(`page.tsx:587`)가 채팅 UI 자체를 막으므로 렌더 전 `localStorage` 에 `tw_participant_name`/`tw_participant_category` 를 심어라.
- 중단 테스트는 스트림을 `new DOMException("Aborted","AbortError")` 로 error 시켜야 한다. 이름이 틀리면 엉뚱한 분기를 통과한다.
- 로컬 `node tooling/checks/docs-links.mjs` 는 gitignore 된 `docs/guides/*.html` 때문에 항상 exit 1 이다. `| grep -v '^docs/guides/'` 로 판정하라(CI 는 초록).

시작점: `docs/research/2026-09-14-mobile-pc-view-strategy.md` §5(단계 1)와 `page.tsx` 의 339~486(handleSend)·179~199(하이드레이션)·319~332(dedupe)를 읽고, `docs/plans/active/` 에 계획 문서부터 쓴다. 그 조사 문서는 아직 untracked 이니 먼저 커밋해라(계획 문서가 링크한다).

완료 기준: `pnpm --filter @truewords/web test` 가 기존 62개 유지 + 신규 9개 이상 통과, lint·typecheck·build·`pnpm format:check` 통과, `git diff --stat` 에 `page.tsx` 부재, `docs/TODO.md`·`docs/README.md` 갱신. 브랜치 `test/chat-page-safety-net`, main 직접 푸시 금지, push·PR·머지는 각각 승인받는다. 배포는 없다.

범위 밖: `page.tsx` 수정(`data-testid` 추가 포함), `useChatSession` 추출, `stripDisclaimer` 중복 제거, breakpoint/`md:`·`lg:` 추가, PC 전용 뷰(계측 데이터 전 금지), `resumedRef` 결함 수정, `docs/design/` 커밋·삭제.
```

**이 세션에서 하지 않을 것**

- `apps/web/src/app/(chat)/page.tsx` 의 **모든 수정** — 리팩터링뿐 아니라 테스트 편의를 위한 `data-testid`·`aria-label` 추가, 주석 정리, import 정렬까지 포함. 테스트가 붙지 않으면 `src/test/setup.ts` 폴리필로 해결한다
- `useChatSession()` 훅 추출, `features/chat/hooks.ts` 신설 — RSH-VIEW-001 §5 단계 2 의 범위다. 이번 세션의 테스트는 그 작업의 **채점 기준**이지 그 작업이 아니다
- `stripDisclaimer` 중복 제거(`page.tsx:91` + `history/page.tsx:45`)와 `lib/reactions-api.ts` 데드코드 삭제 — 단계 2. 특히 dead code 판정은 backend/프론트/테스트/scripts/문서 cross-tier grep 이 선행돼야 한다
- `max-w-2xl` 조정, 여백·타이포 변경, `md:`/`lg:`/`xl:` breakpoint 신규 도입 — 단계 3(데스크톱 접근성 하한). 현재 채팅 화면의 `md:`/`lg:`/`xl:` 0건 상태를 그대로 유지한다
- PC 전용 정보구조 일체 — 3-pane, 근거 패널, 세션 레일, 문장↔청크 각주 정렬, 호버 프리뷰. **승인된 D→A 순차 전략상 계측 데이터 없이 PC UI 를 만드는 것은 전부 범위 밖이다.** 뒤 두 항목은 `ChatSourcesEvent` 스키마 확장이 선행돼야 하는 백엔드 작업이기도 하다
- `docs/design/2026-09-pc-chat/` PC 시안 8개의 커밋(결정 2 에 따라 폐기). **삭제도 하지 않는다** — 미추적 산출물 파기는 사용자 승인 사항이다
- `research_sessions.device_class` 계측, alembic 마이그레이션, `analytics_repository.py` 집계 쿼리, admin 분포 카드 — RSH-VIEW-001 §5 단계 0. 별도 세션이며 개인정보 조항(`AC-PWA-015-01/02`) 검토가 선행된다
- `resumedRef` 두 번째 세션 로드 결함(`page.tsx:173·180`) 수정 — 기존 결함이고 훅 추출과 함께 고치는 편이 안전하다. `docs/TODO.md` 기록만 한다

**완료 기준 (발췌)**

- `pnpm --filter @truewords/web test` 가 **기존 62개 통과 유지 + 신규 9개 이상**으로 끝난다. 기준선은 2026-09-14 실측 `Test Files 9 passed (9) / Tests 62 passed (62)` 이며, 신규 파일 추가 후 `Test Files 10 passed (10) / Tests 71+ passed` 여야 한다
- `pnpm --filter @truewords/web exec vitest run src/test/chat-page.test.tsx` 단독 실행이 통과하고, 출력에 `Warning: An update to ChatPage inside a test was not wrapped in act(...)` 가 0건이다
- 신규 테스트 파일에 `vi.mock("@/features/chatbot/chat-api")`, `vi.mock("@/lib/sse")`, `renderHook`, `useChatSession` 문자열이 0건이다 — `grep -c` 로 확인. (다음 세션의 훅 추출 후에도 살아남기 위한 구조 조건)
- `git diff --stat` 에 `apps/web/src/app/(chat)/page.tsx` 가 **등장하지 않는다**. 변경 파일은 `apps/web/src/test/chat-page.test.tsx`(신규), 필요 시 `apps/web/src/test/setup.ts`(폴리필만), `tests/e2e/playwright.config.ts`(1줄), `docs/**` 로 한정된다
- `tests/e2e/playwright.config.ts` 의 `use` 블록에 `viewport: { width: 1280, height: 720 }` 가 있고, 해당 파일 diff 가 주석 포함 4줄 이하다. `web-flow.spec.ts:36` 의 per-test 390×844 override 는 그대로다
- `pnpm --filter @truewords/web lint`, `pnpm --filter @truewords/web typecheck`, `pnpm --filter @truewords/web build`, `pnpm format:check`, `node tooling/checks/boundaries.mjs` 모두 exit 0

---

### S3 — useChatSession 추출 + 부채 정리

- **목표** `apps/web/src/app/(chat)/page.tsx` 1217줄에서 도메인/통신 로직을 `features/chat/hooks.ts` 의 `useChatSession()` 으로 추출하고 `stripDisclaimer` 중복·dead code 를 제거한다 — PC 뷰 결정과 무관하게 순이익인 **행동 보존 리팩터링**만, 각각 독립 머지·배포 가능한 PR 5개로.
- **브랜치/PR** **전략: 통합 브랜치 없이 main 으로 순차 단독 PR 5개(+선택 1개).** 5개 PR 이 대부분 `page.tsx` 한 파일을 순차 편집하므로 `dev/**` 통합 브랜치는 rebase 비용만 늘린다. 또한 브리프의 "각 단계가 독립 배포 가능해야 한다"는 요건은 순차 main 머지가 문자 그대로 충족한다(각 머지 시점의 main 이 배포 가능). 프로젝트 규칙의 3-tier 는 "여러 sub-task 가 묶이는 큰 작업"용이며 이 세션(~1.3일, 순 라인 증가 0)은 해당하지 않는다.

브랜치(순서대로, 앞 PR 머지 후 `git rebase origin/main`):
1. `chore/web-drop-reactions-api`
2. `refactor/web-chat-pure-modules`
3. `refactor/web-use-chat-session` ← 핵심
4. `test/web-chat-multiturn-guard` (3번과 합쳐도 무방)
5. `refactor/web-source-modal-state`
6. (선택) `refactor/web-feedback-popover-move`
7. `docs/web-chat-debt-cleanup`

머지 전략: free private 레포라 `CI Required` 보호 규칙의 강제력이 0이므로 auto-merge 를 믿지 않는다. `gh pr checks <PR#> --watch` 로 green 확인 후 **`gh pr merge <PR#> --squash --delete-branch` 수동 실행**. 단, `gh pr merge --delete-branch` 는 체크아웃된 worktree 를 지우는 함정이 있으므로 머지 전 main 으로 전환한다.

**git blame 오염 대응.** `.git-blame-ignore-revs` 에 **넣지 않는다** — 그 파일은 "의미 변화 0인 포맷 커밋"용이고(레포에 아직 파일 자체가 없으며, `docs/adr/2026-09-06-biome-migration-proposal.md:45` + `docs/TODO.md:229` 가 Biome 포맷 baseline SHA 등록을 미완 항목으로 예약해 둔 상태다), 이동 커밋을 거기 넣으면 신규 파일의 정당한 저자 정보까지 지워진다. 대신 3가지로 보존한다: (a) PR C 를 **①순수 이동 커밋 + ②적응 커밋** 2개로 분리해 `git blame -C -C -C apps/web/src/features/chat/hooks.ts` 가 원본 줄을 추적할 수 있게 한다(이동 중 rename·포맷 변경 0이 전제 — 코드는 이미 Biome baseline 을 통과한 상태라 `pnpm format:check` 로 확인 가능), (b) `hooks.ts` 머리말에 한 줄 주석으로 출처와 추적 명령을 남긴다 — `// (chat)/page.tsx 에서 추출. 이전 이력: git log --follow -- 'apps/web/src/app/(chat)/page.tsx'`, (c) PR 본문에 동일 명령을 기록한다. 하우스 스타일인 squash 머지를 유지해도 블록 단위 이동은 `-C -C -C` 로 대부분 추적된다.
- **공수** **총 8~10시간 ≈ 1.1~1.4일** (RSH-VIEW-001 §5 단계 2 의 1.5일 추정과 정합; 선택 단계 포함 시 상한 1.5일).

**시작 프롬프트**

```
TrueWords 플랫폼(`/Users/woosung/project/agy-project/truewords-platform`)의 **채팅 부채 정리 세션**을 시작한다.

**배경.** `docs/research/2026-09-14-mobile-pc-view-strategy.md`(RSH-VIEW-001) 결론에 따라 PC 전용 뷰는 보류(D→A 순차)했고, 그와 무관하게 순이익인 §5 **단계 2**만 실행한다. `apps/web/src/app/(chat)/page.tsx` 는 1217줄 단일 컴포넌트다.

**목표 — 독립 머지 가능한 PR 을 순서대로:**
1. `apps/web/src/lib/reactions-api.ts` 삭제 (참조 0건. 백엔드 reaction 라우터·`next.config.ts` rewrite·`FeedbackButtons` 는 사용 중이니 건드리지 마라)
2. `features/chat/text.ts`(`stripDisclaimer`/`stripCitationsBlock` — `page.tsx:88~104` + `history/page.tsx:43~48` 중복 제거) + `features/chat/feedback.ts`(reason 테이블) 순수 이동 + 단위 테스트
3. `features/chat/hooks.ts` 의 `useChatSession()` 으로 도메인 로직 ~320줄 추출. **행동 보존 리팩터링** — 버그 수정·기능 추가 금지
4. `chunkModal` 을 `sourceModalOpen`(뷰 플래그) + `sourceTarget`(도메인 값)으로 분리
5. 문서 갱신(`docs/TODO.md`, RSH-VIEW-001 §5)

**핵심 제약.** 훅은 `page.tsx` 에서 **단 한 번만** 호출한다 — layout/provider 로 올리면 `sendingRef` 동기 가드와 `resumedRef` 마운트 가드가 무력화된다. 훅은 raw setter 를 반환하지 않는다(`setAnswerMode` 만 예외). `input` 은 뷰에 남기고 `send(query)` 로 명시 전달한다. `send` 의 dep 에서 `sessionId` 를 빼지 마라(멀티턴 파괴, 이를 잡는 테스트가 현재 0건이다). main 직접 푸시 금지·PR 필수, 커밋/푸시/머지/배포는 각각 승인받는다.

**시작 전 반드시.** ① `git status` 정리 — 미추적 `docs/design/` 는 폐기 결정이니 커밋하지 말고 삭제, 나머지 2건은 처리 방침을 물어라. ② `rg -l "ChatPage|\(chat\)/page" apps/web/src/test/` 로 페이지 렌더 테스트 존재를 확인하고 **0건이면 중단하고 보고**하라(안전망은 선행 세션 몫이다).

**완료 기준.** `pnpm exec turbo run test typecheck lint build --filter=@truewords/web` + `pnpm format:check` + `node tooling/checks/boundaries.mjs` 통과, `pnpm --filter @truewords/e2e exec playwright test --project=web-chromium` 전부 green, `page.tsx` ≤ 920줄, `rg -n "useChatSession" apps/web/src` 가 정확히 2건.

먼저 코드를 읽고 단계별 계획을 짧게 브리핑한 뒤 시작하라.
```

**이 세션에서 하지 않을 것**

- PC 전용 뷰·3-pane·breakpoint 분기·반응형 레이아웃 변경 일체. 채팅 화면에 `md:`/`lg:`/`xl:` 클래스를 **한 개도 추가하지 않는다**(현재 0회, `sm:` 4회는 전부 버튼 라벨 숨김). 데스크톱 하한(`max-w-2xl` 조정·여백)은 단계 3(별도 세션)이다.
- `docs/design/2026-09-pc-chat/` PC 시안 8개 커밋. 2026-09-14 사용자 결정으로 **폐기**됐다. 커밋하지 말고 삭제하되, 폐기 사실만 문서에 한 줄 남긴다.
- 기기 계측(`research_sessions.device_class` 컬럼·alembic 마이그레이션·analytics 집계·admin 분포 카드). 단계 0 이며 다른 세션이다. `apps/api` 는 이 세션에서 한 줄도 수정하지 않는다.
- `(chat)/page.tsx` 렌더 테스트의 신규 작성(스트리밍 누적/abort/placeholder dedupe/세션 하이드레이션 4경로). 단계 1 선행 세션의 산출물이다. 이 세션이 추가하는 테스트는 **이번 변경을 지키는 2건**(멀티턴 session_id, 더블 전송 placeholder)으로 한정한다.
- `resumedRef` 사전 결함 수정. `useSearchParams` + Suspense 경계 도입이 필요해 행동 보존 리팩터링과 성격이 다르다 → TODO 기록 후 별도 PR.
- `handleBotChange`(`page.tsx:503~508`)의 abort 누락 수정. 발견하되 고치지 않는다 → TODO 기록 후 별도 PR.
- JSX 569줄(643~1085)의 컴포넌트 분해 — 메시지 리스트·헤더·입력바·empty state 를 컴포넌트로 쪼개지 않는다. 이유: (a) props·메모이제이션 경계가 보류된 PC 뷰 결정에 영향받고, (b) JSX 를 덮는 테스트가 없으며, (c) E2E 텍스트 매처가 가장 잘 깨지는 영역이다. 예외는 페이지 state 를 전혀 참조하지 않는 `FeedbackPopover` 순수 이동 1건(선택 단계 7)뿐이다.
- React Query 도입·확장. `useQueryClient` 는 현재 로그아웃 `clear()` 한 줄(`page.tsx:275`)에만 쓰이며 이 세션에서 채팅 상태를 React Query 로 옮기지 않는다.

**완료 기준 (발췌)**

- `wc -l "apps/web/src/app/(chat)/page.tsx"` ≤ 920 (현재 1217). 선택 단계(FeedbackPopover 이동)까지 하면 ≤ 790
- `wc -l apps/web/src/features/chat/hooks.ts` 가 300~420 사이 (그 이상이면 뷰 로직이 딸려 들어간 것)
- `rg -n "useChatSession" apps/web/src` 결과가 정확히 2건 — 정의(`features/chat/hooks.ts`) + 호출(`app/(chat)/page.tsx`) 각 1건. 3건 이상이면 `sendingRef` 동기 가드가 무력화된 것
- `rg -n "DISCLAIMER_PREFIX|stripDisclaimer =|function stripDisclaimer" apps/web/src` 가 `features/chat/text.ts` 와 그 테스트에만 매치 (page.tsx·history/page.tsx 의 지역 복사본 0)
- `rg -n "reactions-api" --glob '!node_modules' .` 0건이고 `tests/e2e/split-apps.spec.ts` 의 reactions rewrite 검증 2건은 그대로 green
- `pnpm exec turbo run test typecheck lint build --filter=@truewords/web` 통과 (vitest 신규 테스트 포함 전부 pass, ESLint 경고 수가 착수 시점 기준선보다 증가하지 않음)

---

### S4 — 데스크톱 하한 충족

- **목표** `apps/web` 채팅 화면이 데스크톱에서 `AC-PWA-014-01`(390px·데스크톱 가로 스크롤 0) 하한을 충족하도록 읽기 폭 상한만 조정하고, 접근성 4항목을 측정해 미달분만 고친 뒤, 가로 스크롤 0 을 E2E 로 상시 검증 가능하게 만든다. 정보구조는 한 줄도 바꾸지 않는다.
- **브랜치/PR** 브랜치 `feat/web-desktop-lower-bound`, base = `main`. **3-tier 통합 브랜치를 쓰지 않는다** — 0.8 사람-일의 단일 응집 변경이라 sub-task PR 로 쪼개면 공유 파일(`page.tsx`·`playwright.config.ts`·`TODO.md`) 충돌 비용만 늘고 이득이 없다. 단일 PR 안에서 커밋 3개로 분리한다: (1) `fix(web): ...` 접근성 미달 2건, (2) `feat(web): ...` 읽기 폭 + E2E 뷰포트 검증, (3) `docs(web): ...` UI-WEB-001 넓은 화면 규정 + TODO. main 직접 커밋·푸시 금지. free private 레포라 required check 강제력이 없으므로 auto-merge 를 쓰지 말고 `gh pr checks <PR#> --watch` 로 CI green 확인 후 **수동 squash 머지**. 머지 후 배포(`make deploy-web`)는 이 세션 범위 밖이며 별도 승인 사안이다. 커밋·푸시·PR 생성 각 단계에서 사용자 승인을 받는다(Git Safety Protocol). 주의: `gh pr merge --delete-branch` 는 체크아웃된 worktree 를 지운 전례가 있으니 머지 전 작업 디렉터리를 확인한다.
- **공수** **0.75~1 사람-일 (약 6.5시간).** 내역: 측정 패스 1.5h(뷰포트 4종 × 화면 5종 + 200% 확대 + 키보드 순회 + reduced-motion 타이밍 = 6개 지표) / `max-w` 4곳 변경 + 재측정 0.5h / 접근성 미달 2건 수정 0.5h(각 1줄) / 새 E2E spec + config 2건 수정 2h(로그인 헬퍼 복제·overflow 진단 헬퍼·반증 1회 포함) / 문서 3건 1h / 전체 검증(`make ci` + `make e2e` 는 compose 기동 포함 10~15분 소요) + PR 1h.

**시작 프롬프트**

```
TrueWords 플랫폼(`/Users/woosung/project/agy-project/truewords-platform`) 세션 S4 — 데스크톱 하한(단계 3)을 진행한다.

배경: `docs/research/2026-09-14-mobile-pc-view-strategy.md`(RSH-VIEW-001)의 D→A 순차 전략이 승인됐다. PC 전용 뷰는 기기 계측 데이터가 쌓이기 전엔 만들지 않는다. 이번 세션은 PRD 접근성 조항 `AC-PWA-014-01`("390px 모바일과 데스크톱에서 가로 스크롤 없이 핵심 플로우를 완료")이 요구하는 **하한만** 충족한다.

할 일:
1. `apps/web/src/app/(chat)/page.tsx` 의 `mx-auto max-w-2xl` 4곳(739·830·1054행과 footer)을 **한 값으로 함께** 넓힌다. 값은 추측하지 말고 브라우저에서 실제 한글 행당 글자수를 재서 40~55자에 드는 **가장 작은** Tailwind 토큰을 고른다(2xl=672 / 3xl=768 / 4xl=896px). breakpoint 는 만들지 않는다 — `max-w-*` 는 좁은 화면에서 자동으로 접히므로 `playwright.config.ts` 의 viewport 문제와 애초에 충돌하지 않는다.
2. 접근성 4항목(200% 확대·키보드·focus-visible·reduced-motion)은 **먼저 측정하고 미달만** 고친다. 확인된 미달 2건: `page.tsx:293` 의 `scrollIntoView({behavior:"smooth"})` 가 reduced-motion 을 무시함 / `globals.css:263` `.prose-chat{font-size:14px}` 가 px 고정이라 텍스트 확대에 반응 안 함. 나머지 arbitrary px 12곳은 손대지 말고 TODO 로 기록.
3. 가로 스크롤 0 을 자동 검증한다. `tests/e2e/ui-theme.spec.ts` 의 `setViewportSize` 패턴을 따라 `viewport-a11y.spec.ts` 를 만들고, `playwright.config.ts` 에 **프로젝트로 등록**(안 하면 조용히 실행 안 됨) + `use.viewport: {1280,720}` 을 명시한다.
4. `docs/specs/web/ui-ux.md`(UI-WEB-001)에 **"넓은 화면" 규정**을 추가한다(현재 "좁은 화면"만 있음). `docs/TODO.md` 도 갱신.

금지: 사이드바·원문 패널·세션 레일·3-pane 등 정보구조 변경 일체. `/history`·`/about`·`/login` 은 이미 데스크톱 레이아웃이 있으니 측정만 하고 손대지 않는다. 새 plan 문서 생성 금지.

절차: `git status --short` 가 비었는지 먼저 확인 → `git checkout -b feat/web-desktop-lower-bound`(main 직접 금지). 착수 전 `make e2e` 로 기준선을 기록한다(admin 사전 결함 5건이 이미 실패 상태). 커밋·푸시·PR 은 각각 내 승인을 받는다. 배포는 범위 밖.

먼저 위 파일들을 읽고, 무엇을 어떻게 측정할지 짧게 브리핑한 뒤 착수하라.
```

**이 세션에서 하지 않을 것**

- **3-pane·사이드바·원문 패널·세션 레일·고정 네비게이션 신설** — 전부 A안 단계 4이고, 계측 데이터 없이 정보구조를 확정하는 것이다. `docs/design/2026-09-pc-chat/` 시안 4안은 폐기 결정이 내려졌으므로 참고 대상도 아니다
- **새 breakpoint 도입 및 채팅 화면의 `md:`/`lg:`/`xl:` variant 추가** — `max-w-*` 만으로 하한이 충족되므로 불필요하고, 도입하는 순간 "데스크톱 전용 레이아웃"의 첫 삽이 된다. 현재 채팅 화면의 `md:`/`lg:`/`xl:` 사용은 0회이며 그대로 0회로 끝내야 한다
- **`/history`·`/about`·`/login` 의 레이아웃 변경** — 셋 다 이미 자체 데스크톱 규칙이 있다(`max-w-[1180px]` + `sm:` 2-pane / `max-w-3xl`+`max-w-5xl`+`md:` / `lg:grid-cols-2`). 가로 스크롤 검증 대상에는 넣되 **측정만** 하고, 실제로 가로 스크롤이 발생한 경우에만 고친다. 채팅과 폭을 "통일"하려는 시도는 정보구조 결정이므로 금지
- **`/design-system` 페이지** — 개발용 컴포넌트 전시이고 핵심 플로우가 아니다. 검증 대상에서 제외한다
- **`useChatSession()` 추출·`stripDisclaimer` 중복 제거·`lib/reactions-api.ts` 정리** — 단계 2(S2)의 범위다. 이 세션에서 "마침 눈에 띄어서" 손대지 않는다
- **`resumedRef` 결함 수정**(`page.tsx:173·180`, 레일/목록에서 두 번째 세션 로드 실패) — 기존 결함이고 레이아웃과 무관하다. 발견 사실만 유지하고 고치지 않는다
- **arbitrary px 폰트 12곳 rem 전환**(`text-[11px]`·`text-[15px]` 등) — 이번엔 `.prose-chat` 1곳만 바꾸고 나머지는 TODO.md 후속으로 기록한다. 12개 컴포넌트를 동시에 건드리면 타이포그래피 재설계가 된다
- **skip link 신설·랜드마크 재구성·ARIA 구조 개편** — 측정해서 부재를 기록하되 이번에 만들지 않는다. WCAG 2.4.1 은 `AC-PWA-014-01` 하한 조항이 아니다

**완료 기준 (발췌)**

- **가로 스크롤 0 자동 검증**: 새 spec `tests/e2e/viewport-a11y.spec.ts` 가 390×844 / 768×1024 / 1280×720 / 1440×900 네 뷰포트 × (`/` 빈 화면, 답변 1건 렌더 후, `/history`, `/about`, `/login`) 조합에서 `document.documentElement.scrollWidth - clientWidth <= 0` 를 통과한다. 실패 시 원인 element 의 `tagName + className` 을 출력한다(`overflowX` 가 `auto|scroll` 인 조상은 제외 — `.prose-chat pre`·`table` 은 globals.css:325·338 에서 의도적으로 `overflow-x:auto`). 재현: `pnpm --filter @truewords/e2e exec playwright test --project=web-viewport-chromium`
- **행당 글자수 실측이 40~55 구간**: 1440×900 에서 assistant 답변 본문의 실제 한글 행당 글자수를 DOM 에서 측정(`Range` 로 텍스트 노드를 행 단위 분해 후 행별 글자수 중앙값)했을 때 40~55. 변경 전 기준값(≈38.5, `max-w-2xl` 672px → bubble 85% 571px → Card px-4 제외 539px ÷ 14px)도 같은 스크립트로 찍어 PR 본문에 전후 수치를 남긴다
- **390px 렌더 불변**: 390×844 에서 채팅 메시지 컨테이너의 `clientWidth` 가 변경 전후 동일한 358px(= 390 − `px-4` 좌우 32px). 새 spec 이 이 값을 상수로 assert 한다. `max-w-*` 는 `min(cap, 가용폭)` 이므로 cap 을 키워도 좁은 화면은 수학적으로 불변이며, 이를 테스트로 고정한다
- **reduced-motion 준수**: `page.emulateMedia({ reducedMotion: "reduce" })` 상태에서 질문 전송 후 `requestAnimationFrame` 2프레임 내에 스크롤 컨테이너의 `scrollTop` 이 목표값에 도달한다(현재는 `page.tsx:293` 의 `behavior:"smooth"` 때문에 수백 ms 에 걸쳐 이동)
- **텍스트 200% 확대 대응**: `page.addStyleTag({ content: "html{font-size:32px!important}" })` 주입 후 `.prose-chat` 의 computed `font-size` 가 28px 이고(현재 `globals.css:263` 이 `14px` px 고정이라 14px 로 고정됨), 그 상태에서도 1280×720 가로 스크롤 0
- **기존 E2E 회귀 0**: `make e2e` 결과가 admin 프로젝트의 기존 사전 결함 5건(`data-source-delete` 4 + `admin-flow.spec.ts:197` 1) 외 신규 실패 0. `web-chromium` 6 · `ui-theme-chromium` 4 · `split-apps-chromium` 전부 green

---

## 갱신이 필요한 문서

| 문서 | 내용 | 담당 |
|---|---|---|
| `docs/adr/2026-09-14-mobile-pc-view-strategy.md` (신규) | `DEC-VIEW-001`(D→A 순차) + `DEC-VIEW-002`(PC 시안 폐기) | **0단계에서 소유자 고정** |
| `docs/research/2026-09-14-mobile-pc-view-strategy.md` | 상태를 '결정 확정'으로, §5 단계 0-2(시안 커밋) 철회 | S1 |
| `docs/specs/analytics/event-dictionary.md` (신규, `EVT-001`) | device_class 의 목적·속성·수집 시점·보존 기간·접근 역할 + 신규 세션 한정 기록 한계 | S1 |
| `docs/specs/web/ui-ux.md` (`UI-WEB-001`) | **"넓은 화면" 절 신설** — 현재 "좁은 화면"만 있다 | S4 |
| `docs/plans/active/2026-09-14-chat-page-safety-net.md` (신규, `CHAT-TEST-001`) | 안전망 계획 | S2 |
| `apps/web/AGENTS.md` | `features/chat/{hooks,text,feedback,types}.ts` 신설 반영 | S3 |
| `.ai/rules/frontend.md` | FSD 예시(136~146행)의 `features/[domain]/hooks.ts` 가 첫 구현을 얻는다 | S3 |
| `tests/e2e/README.md` | 새 viewport 프로젝트와 실행법 | S4 |
| `docs/TODO.md` | 계측 재판단 **목표 날짜 2개 + 최소 표본 기준**, `make deploy-web` 후속 | 각 세션 마지막 커밋 |
| `docs/README.md` | 색인에 `EVT-001`·`DEC-VIEW-001`·`CHAT-TEST-001` 등록 | 마지막 세션 |

---

## 미해결 질문

- `[확인 필요]` `device_class` 보존 기간. 훈독 PRD `AC-PWA-015-02` 가 이벤트 사전에 보존 기간 기록을 요구하는데 레포에 동의 수집 지점이 0건이다. 파생 3값이라 실질 위험은 낮지만 **그 판단 근거를 이벤트 사전에 명시**해야 조항을 충족한다
- `[확인 필요]` `/history`(515줄) 존치. 단계 4에서 세션 레일을 만들면 `/history` 는 "검색·필터가 되는 레일" 이상이 아니게 된다
- `[확인 필요]` 훈독 PWA PRD 4개 경쟁안(PR #262~#265)이 `DEC-PWA-017` 미해결이다. 정보구조가 서로 충돌하므로 이것이 정해지기 전에 챗 정보구조를 확정하면 나중에 충돌한다
- `[확인 필요]` S4 결과물의 운영 배포. 4개 세션 중 유일하게 사용자 화면을 바꾸는데 후속 배포 항목이 없으면 로컬/main 에만 남는다
