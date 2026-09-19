# Biome 전환 제안 ADR — ESLint(eslint-config-next) → Biome 2.x, 포맷터 첫 도입

- **작성일**: 2026-09-06
- **상태**: **결정 확정 (2026-09-06 사용자 승인).** P3 ①·② 는 브랜치 `chore/biome-format-baseline` 에서 실행 완료(아래 실행 기록), ③·④ 는 후속 PR. ④ 전까지 `packages/eslint-config` 와 ESLint 는 그대로 둔다
- **관련**: [툴체인 최신화 ADR](2026-09-06-toolchain-latest-decisions.md) · [모노레포 설계 ARCH-MONO-001](../architecture/2026-09-05-pwa-flutter-monorepo.md) · [프론트엔드 규칙](../../.ai/rules/frontend.md)

## 배경

사용자가 ESLint · Prettier 를 Biome 으로 전환할 계획을 밝혔다. 실측하니 이 레포에는 **Prettier 가 없고** ESLint 도 `eslint-config-next`(core-web-vitals + typescript) 만 쓴다. 따라서 전환의 실체는 "ESLint 교체" 가 아니라 **"ESLint 교체 + 포맷터 첫 도입"** 이다. `packages/eslint-config` 는 [ARCH-MONO-001](../architecture/2026-09-05-pwa-flutter-monorepo.md) 이 유지하기로 한 공유 패키지 3개 중 하나라 대체에는 결정이 필요하다.

## 실측 (Biome 2.5.12, main `a633400` + 툴체인 스파이크, 2026-09-06)

| 항목 | 결과 |
|---|---|
| `biome migrate eslint --include-inspired` | `eslint-config-next` 에서 **28 규칙 매핑**(typescript-eslint 계열 + `noImgElement` · `noHeadElement` · `noDocumentImportInPage` · `useGoogleFontDisplay` 등). **미매핑**: react-hooks v7 컴파일러 규칙 전부(`set-state-in-effect` · `set-state-in-render` · `static-components` · `unsupported-syntax` · `use-memo` …) 와 `@next/next/*` 11종(`no-html-link-for-pages` · `no-location-assign-relative-destination` · `next-script-for-ga` …) |
| 대체 수단 | `linter.domains: { react: "recommended", next: "recommended" }` (`useExhaustiveDependencies` ≈ exhaustive-deps, `useHookAtTopLevel` ≈ rules-of-hooks, `noImgElement` · `noHeadElement` …) + nursery `useReactCompiler`(React Compiler 분석, 컴파일러 규칙의 대응) |
| 레포 전체 진단(174 파일, recommended + react/next 도메인) | **307 errors / 40 warnings / 5 infos** — `organizeImports` 100(자동 수정), `useButtonType` 18, `noArrayIndexKey` 18, `useExhaustiveDependencies` 12, `useIterableCallbackReturn` 10, a11y 14(`noLabelWithoutControl` 5 · `useSemanticElements` 5 …), `noNonNullAssertion` 7(warn), `useImportType` 14(warn) 등 |
| 포맷터 | 173 파일 중 **134 파일 변경**(현재 포맷터가 없어 스타일이 파일마다 다름) |
| Tailwind v4 | `css.parser.tailwindDirectives: true` 로 `@theme` · `@utility` 파싱. 클래스 정렬은 nursery `useSortedClasses`(옵션으로 `cn` · `cva` 함수 지정) |
| 모노레포 | 루트 `biome.json` + 앱별 `biome.jsonc { "extends": "//" }`. 생성물(`packages/api-client-ts/src/generated`) · `.next` · `docs` · `contracts` 는 `files.includes` 로 제외 |
| 속도 | 174 파일 lint 86ms · format 21ms (ESLint 양 앱 각 10~30s) |

## 제안하는 결정 (승인 대상)

| # | 제안 | 이유·대안 |
|---|---|---|
| P1 | **Biome 2.x 를 유일한 lint · format 도구로 채택**하고 `packages/eslint-config` 와 각 앱의 `eslint.config.mjs` · `eslint` · `eslint-config-next` 의존성을 제거한다 | 대안 A "ESLint 유지 + Biome 포맷터만" 은 도구 2개 유지 비용. 대안 B "유지" 는 react-hooks v7 13건과 느린 lint 가 남는다. 미매핑 `@next/next/*` 11종은 대부분 `pages/` · `_document` 시대 규칙이라 App Router 앱에 실질 영향이 작다 — 단 `no-html-link-for-pages`(내부 링크에 `<a>`) 는 리뷰 체크리스트로 흡수 |
| P2 | **포맷 규칙**: 2-space · double quote · lineWidth 120 · semicolons 유지(현재 코드 다수 스타일) | 첫 도입이므로 기존 코드에 가장 가까운 값을 택해 diff 를 줄인다 |
| P3 | **단계 도입**: ① 루트 `biome.json` + `useSortedClasses` 는 끔 ② `biome check --write`(organizeImports · format) **1커밋**(134 파일, 로직 변경 0 — 리뷰는 "포맷만" 으로) ③ 규칙 위반 수동 정리는 **파일군별 소커밋**(a11y → hooks → noArrayIndexKey 순) ④ CI `pnpm lint` → `biome ci .` 로 교체, `packages/eslint-config` 삭제, `.ai/rules/frontend.md` · `AGENTS.md` · `docs/README.md` 갱신 | 한 PR 에 포맷과 로직 수정을 섞으면 리뷰가 불가능하다 |
| P4 | **React Compiler 규칙은 Biome nursery `useReactCompiler` 를 warn 으로 켠다** | 툴체인 ADR D4 의 13건 추적을 이 규칙으로 이어받는다. nursery 이므로 error 승격은 안정화 후 |

## 예상 작업량과 위험

- 자동 단계(②·④): CC 기준 30분. 수동 정리(③): 위반 ~200건(자동 제외) → 파일군별 3~4 PR, 각 1시간 안팎. `noArrayIndexKey` 18건은 key 설계를 다시 봐야 해 화면 확인이 필요하다.
- 위험: 포맷 1커밋 뒤 열린 PR(#252 등)은 전부 충돌한다 → Dependabot PR 은 재생성되므로 무시, 사람 PR 이 없는 시점에 실행한다. `git blame` 은 `.git-blame-ignore-revs` 에 포맷 커밋을 등록해 보존한다.
- 되돌리기: ESLint 제거는 마지막 단계(④)라 그 전까지는 `pnpm lint` 가 그대로 동작한다.

## 실행 기록 (2026-09-06, P3 ①·②)

- **①** 루트 `biome.json` 1개만 둔다(앱별 `extends: "//"` 는 앱별 override 가 생길 때). P2 값 그대로. `files.includes` 로 `apps/api`(Python) · 생성 SDK · `contracts` · `docs` · **`reports`(측정 산출물) · `pyrightconfig.json`(Python 툴 설정)** 을 제외 — 뒤 둘은 실측에서 포맷 대상에 잡혀 추가했다. `.gitignore` 는 `vcs.useIgnoreFile` 로 따른다. Biome 2.5 차이 2개: `linter.rules.recommended` 는 deprecated → `rules.preset: "recommended"`, 폴더 제외는 `/**` 없이(`useBiomeIgnoreFolder`). 루트 스크립트 `pnpm format`(`biome check --linter-enabled=false --write .`) · `pnpm format:check` 추가.
- **②** `biome check --linter-enabled=false --write .` — formatter + `organizeImports` 만 적용하고 **lint 자동 수정(safe fix)은 넣지 않았다**(`useImportType` · `useTemplate` 등은 ③ 로). 결과 **140 파일**(포맷 134 ∪ import 정렬 100; tsx 89 · ts 34 · mjs 10 · json 5 · css 2), +2,271 / −3,800. side-effect import(`./globals.css`) 위치는 유지된다. CSS 는 `oklch(0.180 …)` → `0.18` 같은 숫자 정규화만.
- **검증(로컬, pnpm 12.3.4)**: typecheck 3/3 · ESLint 경고 13(툴체인 ADR D4 와 동일, 오류 0) · vitest 22 파일 · tooling 16 · `contracts:check` · `boundaries:check` · `docs:check` · `next build` web + admin 전부 통과.
- **남은 진단(③ 범위, ② 적용 후 실측)**: **error 57 / warning 43 / info 7** — error: `useButtonType` 17 · `noArrayIndexKey` 16 · `useExhaustiveDependencies` 8 · `useIterableCallbackReturn` 6 · `noLabelWithoutControl` 4 · `useSemanticElements` 4 · `noStaticElementInteractions` 1 · `noAssignInExpressions` 1 / warning: `useImportType` 13 · `useReactCompiler` 7 · `noImportantStyles` 6 · `noUndeclaredEnvVars` 5 · `noNonNullAssertion` 5 · `noGlobalIsNan` 3 · `noExplicitAny` 2 · `noConfusingVoidType` 1 · `noDescendingSpecificity` 1. 위 실측 표의 "307 errors" 와 예상 "~200건" 은 포맷 134 + organizeImports 진단을 lint 와 합산한 수치였다 — 수동 정리 대상은 100건이며 ③ 은 2~3 PR 로 줄어든다.
- **브랜치 배치**: 작업 시점의 유일한 열린 사람 PR #256(이 ADR 을 담은 툴체인 PR) 위에 스택해 실행했고, #256 이 main 에 squash 머지(`b281ee5`)된 직후 main 으로 rebase 했다(트리 동일, 충돌 0). 열린 사람 PR 이 0 인 상태에서 main 으로 PR 을 낸다 — ADR 의 실행 조건 충족.
- **`.git-blame-ignore-revs` 는 머지 후 등록**: squash · rebase 머지가 SHA 를 바꾸므로 브랜치 SHA 를 지금 넣으면 무효가 된다. 머지된 포맷 커밋 SHA 로 ③ 첫 PR 에서 추가한다.
