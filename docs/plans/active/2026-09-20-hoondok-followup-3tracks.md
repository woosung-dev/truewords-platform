# PLAN-HD-004 — 훈독 후속 3트랙 (배포 안전망 · 디자인 품질 · Phase 3 종결)

- 착수 2026-09-20. 기준 main `56a80f7`. 산출은 **PR 1개**(base `main`).
- 이 문서는 오케스트레이터가 소유한다. 트랙 서브에이전트는 편집하지 않는다.
- 근거: [`PLAN-HD-001` §6](2026-09-17-hoondok-mvp.md), [runbook §실행 기록](../../runbooks/hoondok-pwa-rollout.md#실행-기록), [`DES-PWA-003`](../../specs/web/hoondok-design-system.md).

## 1. 트랙

| 트랙 | 범위 | 소유 파일 | 상태 |
|---|---|---|---|
| A 배포·CI 안전망 | `docs-links.mjs` 가 `.gitignore` 존중 · `deploy-guard` 후퇴 배포 차단 + 테스트 | `tooling/checks/*`, `Makefile` | ✅ 머지 `71599f6` · 검증 GREEN |
| B1 디자인 (훈독 루프) | `/hoondok`·`/read`·`/onboarding`·`/offline` | 해당 `page.tsx`, `features/hoondok/{components,note,jeongseong,install}/`, `_hoondok/{note,sheet}.css` | ✅ 머지 `515bdee` · 검증 GREEN (P2 3 → 전부 정리 `54b1f18`) |
| B2 디자인 (기록·질문) | `/garden`·`/settings`·`/ask`·`/ask/[id]`·`/ask/log` | 해당 `page.tsx`, `features/hoondok/{garden,settings,ask}/`, `_hoondok/{garden,settings,ask}.css` | ✅ 머지 `880a51f` · 검증 GREEN (P2 4 → 3건 정리 `54b1f18`, 1건 §2 보류) |
| C Phase 3 종결 문서 | `PLAN-HD-001` §6 현황표 확정 · TODO | `docs/plans/active/2026-09-17-hoondok-mvp.md`, `docs/TODO.md`, runbook | ✅ 머지 `2043b0c` · 검증 GREEN |

**공유 파일(B 트랙 편집 금지)**: `apps/web/src/app/hoondok.css`(토큰), `app/(hoondok)/hoondok/layout.tsx`, `features/hoondok/{tabs,screens,flag}.ts`, `components/hoondok/*`.
필요 시 보고만 하고 오케스트레이터가 한 번에 처리한다.

## 2. 차단 항목 (이번 PR 비범위)

| 항목 | 차단 근거 |
|---|---|
| Phase 4 알림 | `PLAN-HD-001` §7 — "Phase 3 데이터를 본 뒤" |
| 프리뷰 셸 8라우트 실데이터화 | `DEC-PWA-020`·`021` 외부 결정 대기 |
| 약관·`DEC-PWA-001` | 별도 세션 |
| `make deploy-*` | 이 세션은 배포하지 않는다 |
| 실기기 증거 | 사용자가 채운다 (헤드리스 대체 불가) |
| `sourceFields()` 화자 칸 | B2 감사 P2. `/chat/stream` 이 화자를 주지 않아 칸을 둘지·`volume` 중복을 감수할지가 설계 판단이다 `[확인 필요]` |

## 3. 검증 게이트

1. 트랙별 `--no-ff` 로컬 머지
2. `make ci` (docs:check 오탐이 트랙 A 로 해소되면 `build`·`typecheck` 까지 도달해야 한다)
3. `make e2e`
4. codex evaluator 2회 (트랙 B 직후 · PR 직전), 라운드 상한 3

## 4. 진행 기록

| 시각 | 사건 | 결과 |
|---|---|---|
| 착수 | 컨텍스트 확인 완료 | docs:check 새 오류 11건(전부 `docs/guides/redteam-test-guide-v2.html`, gitignore 대상) 재현 확인 |
| 워크플로 | 10 에이전트 (Recon 1 · 구현 4 worktree · 감사 2 · 검증 3) | 오류 0. 검증 3건 전부 **GREEN**, 지적은 전부 P2 |
| 통합 | 4 브랜치 `--no-ff` 머지 → `880a51f` | 34파일 +958/−212. 충돌 0 |
| 통합 | 범위 밖 브랜치 분리 | `chore/worktree-gc`(`7dd4ad9`, worktree GC 스크립트 195줄)가 이 세션과 무관하게 레포 HEAD 에 있었다. 이 PR 비범위로 분리하고 해당 브랜치에 남겼다 |
| 정리 | P2 데드코드 6건 제거 → `54b1f18` (부모 `83d68a8`) | 4파일 +1/−21. `.masthead`·`.form__msg`·`.read-ask`(B1 소비자 0) · `.st-sub[disabled] .st-sub__v`·`.ask-wait .btn`(B2 효과 0) 삭제, `sourceLabel` 은 `export` 만 제거. 검증: `hoondok:check` 통과 · Vitest **26 files / 214 passed** · lint 0 errors 10 warnings(전부 이 PR 밖) · typecheck · `next build` 23 라우트 |
| 정리 | 기준선 수치 정정 | 감사 보고서의 web Vitest **211** 은 낡은 값이다. 순정 `83d68a8` 에서 재측정해도 **214 passed / 26 files** — 정리 커밋은 테스트 중립 |
| 정리 | worktree 베이스 어긋남 | 정리용 worktree 가 `83d68a8` 이 아닌 `56a80f7`(B1·B2 머지 이전)에서 생성됐다. 조상 관계·고유 커밋 0 확인 후 fast-forward 로 교정. **커밋이 `feat/hoondok-followup-3tracks` 가 아닌 `worktree-agent-a709912d3fadbe9ac` 위에 있어 옮겨 붙여야 한다** |
| 게이트 | `make ci` · `make e2e` (HEAD `91c73fe` 이전 트리) | `make ci` exit 0 — pytest **1069 passed / 4 skipped / 1 xfailed**, `tooling:test` 39, docs:check 문서 190 · 링크 324 · **새 오류 0**, hoondok:check 9파일, web Vitest **218 / 26 files**, admin 116, api-client 13, lint 0 errors, build·typecheck 통과. `make e2e` **85 passed (1.8m)** |
| codex 1회차 | 트랙 B 직후 (exec `-s read-only`) | 지적 2건 모두 수정·머지(`91c73fe`): ① `read-complete-button.tsx` 가 서버 미확정 상태에서 "연속 N일째" 를 적던 거짓 문구 ② 제출 중 버튼에 진행 표시 부재 → `HoondokButton isLoading` + `.btn__spinner`(DES §1.5) |
| codex 2회차 | PR 직전 (exec `-s read-only`) | 새 지적 2건: `[P1]` `deploy-guard` 의 `\|\| true` 가 원격 셸 안에 있어 `.env` **읽기 실패(exit 2)** 를 "첫 배포" 로 오판 · `[P2]` `.btn__spinner` 의 reduced-motion 되살림이 **레이어 밖**이라 `globals.css` `@layer base` 의 `!important` 에 져 스피너가 멈춤. 둘 다 수정·머지(`8720e70`) |
| 발산 판정 | "이전 닫힘(2) − 새로 열림(2) = 0" | 사용자 규칙상 중단 신호다. **codex 호출을 여기서 멈췄다**(2회 예산 소진 + 규칙). 다만 thrash 는 아니라고 판단한다 — 2회차 범위가 더 넓었다: `[P1]` 은 1회차가 보지 않은 `Makefile`, `[P2]` 는 1회차 수정이 만든 새 코드다. 대체 검증은 `make ci`·`make e2e` + 독립 에이전트로 했다 |
| 브라우저 검토 | 사용자 요청 — 내장 브라우저로 9 실데이터 라우트를 375 · 768 · 1280 에서 정본 프로토타입과 대조 | 검토 장비: e2e compose(postgres :15432 · qdrant :16333) + 로컬 API :8000 + web :3140(`HOONDOK_ENABLED=1`·`HOONDOK_PREVIEW=1`) + 프로토타입 :4173, 시드 사용자 `hoondok@example.com` 로그인 |
| 브라우저 검토 | **정본의 성격 확정** — `docs/prd/prototypes/hoondok-ds/hoondok.css`(499줄) 는 **프리미티브 라이브러리**다 | 정의된 선택자 ~110개가 전부 공용(`.card`·`.sect`·`.btn`·`.mission`·`.week`·`.stats`·`.badge`·`.nav`·`.appbar`·`.progress` …). 화면 전용 클래스는 CSS 가 **0줄**이다(`.gd-*` 0 · `.st-sub` 0 · `.ask-q`/`.ask-ref`/`.ask-row` 0 · `.onb-*` 2). 즉 정본은 **토큰·프리미티브의 기준**이지 화면 레이아웃의 픽셀 기준이 아니다 |
| 브라우저 검토 | 프리미티브 42종 computed style 대조 | **실질 불일치 0.** 남은 차이는 (a) 변형 클래스 표본 차이(`.btn` 을 구현 쪽에서 `--sm` 이 먼저 잡히는 등), (b) 아이콘 폰트(프로토타입 Phosphor) ↔ SVG(lucide) 로 `font-size` 가 무의미한 경우, (c) `.my-note` 의 의도된 이탈(16px = iOS 확대 방지 · 테두리 `--ink-3` = DES §10) 뿐이다 |
| 브라우저 검토 | 라우트·네트워크·콘솔 | 9 라우트 전부 200, 훈독 API(`auth/me`·`me/summary`·`me/history`·`me/jeongseong`) 전부 200. 앱 레벨 콘솔 오류 0(나머지는 dev HMR 소음). 브레이크포인트 768 · 1024 · 1224 가 정본과 일치 |
| 브라우저 검토 | 상태 화면 | `/hoondok/ask/log` 빈 상태·`/hoondok/ask/<없는 id>` 없음 상태·`/hoondok/offline` 폴백 모두 제목+본문+행동 3단으로 규격대로. 설정의 알림 토글은 "준비 중" disabled (Phase 4 차단과 일치) |
| 브라우저 검토 | 결함 2건 수정 → 머지 `4f49484` · 롤백 `edb2545` | ① `.mission__title` 2줄 제한(`.ql-q` 와 같은 규격) — 375px 미션 카드 `[176,92,92]` → `[133,92,92]`, 정본은 `[92,114,92]`. ② 캔버스 배경 수정은 **되돌렸다**(아래) |
| 브라우저 검토 | **캔버스 배경 수정 롤백** | 토큰 블록 선택자를 `html:has([data-app="hoondok"])` 까지 넓히자 `make e2e` 가 `tests/e2e/hoondok.spec.ts:57` 에서 실패했다 — 훈독 팔레트가 `:root` 로 새지 않는지 지키는 **명시적 경계 계약**이다. 계약을 우회해 통과시키지 않고 되돌렸고, 세 안(계약 좁히기 · `overscroll-behavior-y: none` · 유지)을 `docs/TODO.md` Questions 에 남겼다. 노출은 `min-height:100dvh` 덕에 **고무줄 오버스크롤 순간뿐**이다 |
| 게이트 | 최종 `make ci` · `make e2e` | 아래 "최종 검증" 절 |

## 5. 최종 검증 (`edb2545`)

| 게이트 | 결과 |
|---|---|
| `make ci` | **exit 0** — pytest 1069 passed / 4 skipped / 1 xfailed · `tooling:test` **42 pass / 0 fail** · docs:check 문서 190 · 링크 324 · **새 오류 0** · hoondok:check 9파일 · web Vitest **222 / 26 files** · admin 116 · api-client 13 · lint **0 errors**(warning 10+3 은 전부 이 PR 밖) · build 23 라우트 · typecheck |
| `make e2e` | **85 passed (1.8m)** — `docs/TODO.md` 의 "배포 트리 기준 `make e2e` 재실행" 공백을 이 실행으로 메운다 |

### 라이브 브라우저 검토 범위

- 실데이터 9라우트 × 375 · 768 · 1280 = 대조 27회, 프리뷰 셸 8라우트 × 375
- 프리미티브 42종 computed style 을 정본과 1:1 대조 — 실질 불일치 0
- 대비 10쌍 전부 WCAG AA 통과 (최저 `--ink-3` on `--surface-2` 4.66:1)
- `prefers-reduced-motion: reduce` 를 Playwright 로 실측 — 스피너 2종만 `hoondok-spin 1.2s infinite` 유지, 장식 모션은 `animation-name: none`
- 상태: 빈(`/ask/log`) · 없음(`/ask/<없는 id>`) · 오프라인 · 스켈레톤(`/garden`) 라이브 확인. **오류 상태는 코드로만 확인** — React Query 가 이전 데이터를 유지해 라이브 재현이 안 됐고, 그것이 올바른 동작이다
