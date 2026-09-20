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
