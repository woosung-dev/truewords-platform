# 툴체인 최신화 결정 ADR — pnpm 12 · TypeScript 6(7 보류) · Next 16.3 · react-hooks v7 단계 도입

- **작성일**: 2026-09-06
- **상태**: 결정 확정 · 구현 브랜치 `chore/toolchain-latest-spike` (PR 1개, 코드 변경은 테스트 로케이터 1건과 lint 설정만)
- **관련**: [Biome 전환 제안 ADR](2026-09-06-biome-migration-proposal.md) · [CI·독립 배포 runbook](../runbooks/ci-cd-pipeline.md) · [환경 가이드](../runbooks/environment-setup.md) · [CI/CD 점검 ADR](2026-09-05-cicd-audit-decisions.md)

## 배경

Dependabot 이 2026-09-06 에 열어 둔 메이저 PR(#253 typescript 7.0.2, #254 @types/node 26)과 minor/patch 그룹(#252: next 16.3.4 등 19종)이 모두 CI 빨간 상태로 남았다. "latest 로 올리면 무엇이 깨지는가" 를 추측 대신 실측하기 위해 main `a633400` 에서 스파이크 worktree 를 만들어 pnpm · TypeScript · Next 를 최신으로 올리고 전체 검증(install · peers · typecheck · lint · vitest · openapi-ts 재생성 · next build · 격리 E2E · Docker 이미지 빌드)을 돌렸다.

## 실측으로 확인한 사실 (2026-09-06, main `a633400`)

| 영역 | 사실 | 근거 |
|---|---|---|
| TypeScript 7.0.2 (latest) | JS 컴파일러 API 를 제공하지 않는다. ① `typescript-eslint` 8.69 가 `does not support TS 7.0` 하드 에러(peer `>=4.8.4 <6.1.0`) → 양 앱 lint 불가 ② `@hey-api/openapi-ts` 0.99 가 `TypeError: Cannot read properties of undefined (reading 'AnyKeyword')` 로 크래시 → SDK 재생성 불가 ③ `next build` 가 "TypeScript 7.0.2 does not provide the compiler API required by Next.js. Enable `experimental.useTypeScriptCli` … or install TypeScript 6" 로 중단. `tsc --noEmit` 자체는 3/3 통과(2.7s) | 스파이크 로그, #253 CI run 34011000534 |
| TypeScript 6.0.3 | peers 0건 · typecheck 3/3 · openapi-ts 재생성 diff 0 · next build 통과. 6.x 는 JS API 를 가진 마지막 라인 | 스파이크 |
| pnpm 12.3.4 | ① `package.json` 의 `pnpm.overrides` 를 **읽지 않고 경고만 낸다** → #231·#234 로 넣은 전이 의존성 보안 상향 16종이 조용히 무시된다 ② `unrs-resolver` postinstall 이 `ERR_PNPM_IGNORED_BUILDS` 로 설치를 중단(허용 목록 필요) ③ lockfile v6 → v9 재생성(+6093/−4802) | 설치 로그 `[WARN] The "pnpm" field in package.json is no longer read by pnpm` |
| Next 16.3.4 | build web 27.6s · admin 29.4s 성공, vitest 22 파일 통과, 격리 E2E 38/38(아래 1건 수정 후). `next dev` 가 `apps/*/AGENTS.md` 에 `nextjs-agent-rules` 블록을 자동 기록(`next.config.ts` `agentRules: false` 로 끔). 클라이언트 내비게이션 뒤 `__next-route-announcer__`(aria-live) 가 h1 문구를 복제해 `getByText` strict 위반 — #252 E2E 실패의 원인. Turbopack 은 Google Fonts fetch 실패를 `Module not found: @vercel/turbopack-next/internal/font/google/font` 로 보고하고 재시도하지 않는다(vercel/next.js#97376·#97378) | 스파이크 E2E 2회(1회 폰트 fetch 실패 → 재시도 통과) |
| eslint-config-next 16.3.4 | eslint-plugin-react-hooks v7 의 React Compiler 규칙을 error 로 켠다. 이 레포는 13건: web 10(`set-state-in-effect` 8 · `refs` 1 · `exhaustive-deps` warn 1), admin 3(`set-state-in-effect` 1 · `immutability` 1), 양 앱 `lib/api.ts` 의 `window.location.href` warn 2 | `pnpm exec eslint .` 양 앱 |
| @types/node 26 (#254) | CI 는 초록이지만 런타임은 Node 22(`node:22-alpine`, CI `node-version: 22`, `engines >=22`). 타입만 26 이면 없는 API 를 있다고 믿는다 | Dockerfile · 워크플로 |

## 결정

| # | 결정 | 대안과 이유 |
|---|---|---|
| D1 | **TypeScript 6.0.3 채택, 7.x 보류** | 7.x 는 typescript-eslint(추적 이슈 typescript-eslint#10940) · openapi-ts · Next 가 지원할 때 재검토한다. `experimental.useTypeScriptCli` 로 build 만 살리는 길은 lint 와 SDK 생성이 죽어 의미가 없다. Dependabot 이 매달 7.x 를 다시 열지 않도록 `dependabot.yml` 에 `typescript` semver-major ignore |
| D2 | **pnpm 12.3.4 채택 + 설정을 `pnpm-workspace.yaml` 로 이동** | overrides 16종과 `allowBuilds.unrs-resolver` 를 workspace 파일로 옮겨야 pnpm 10+ 에서 보안 상향이 살아난다. Dockerfile `corepack prepare pnpm@12.3.4`, CI 는 `pnpm/action-setup@v4` 가 `packageManager` 를 읽어 자동 추종. 로컬은 `corepack enable` 권장 |
| D3 | **Next 16.3.4 채택** | build · vitest · E2E 모두 통과. E2E 는 접근 거부 문구 로케이터를 `getByRole("heading")` 으로 한정(route announcer 중복). `agentRules` 는 기본값(자동 기록) 유지 — 앱 AGENTS.md 에 블록을 커밋해 트리를 깨끗하게 둔다 |
| D4 | **react-hooks v7 컴파일러 규칙은 warn 으로 단계 도입** | 13건 전부 `useEffect` 안 `setState` 같은 UI 동작 수정이라 화면 확인 없이 고치지 않는다. `packages/eslint-config/next.mjs` 에서 컴파일러 규칙 15종을 warn 으로 두고, 수정은 `docs/TODO.md` 항목으로 추적한 뒤 error 로 되돌린다. `rules-of-hooks` · `exhaustive-deps` 는 그대로 |
| D5 | **@types/node 는 런타임과 같은 메이저(`^22`)** | #254 는 close. `dependabot.yml` 에 `@types/node` semver-major ignore. Node 를 올릴 때 함께 올린다 |
| D6 | **#252 는 툴체인 PR 이 next · eslint-config-next 16.3.4 를 흡수하고 나머지는 Dependabot 재생성에 맡긴다** | 남는 것은 react 19.2.8 · react-query · vitest 4.1.11 등 안전한 minor/patch 와 `@base-ui/react` 1.3 → 1.7. UI 라이브러리는 화면 확인 후 머지 |

## 하지 않기로 한 것

- `experimental.useTypeScriptCli` 로 TS 7 강행, vitest 5 / eslint 10 메이저 동시 상향(요청 범위 밖, Dependabot 이 별도 PR 로 올림), `next/font/local` 자체 호스팅(폰트 fetch 실패 재발 시 검토), react-hooks 위반 13건의 즉시 코드 수정.

## 검증 기록 (스파이크, 2026-09-06)

`corepack pnpm@12.3.4 install` 통과 · `pnpm peers check` 0건 · `pnpm typecheck` 3/3 · `pnpm lint` errors 0(warn 13) · `pnpm test` 22 파일 통과 · `pnpm sdk:generate` diff 0 · `pnpm build` web·admin 성공 · `make e2e` 37 passed + 1 fixed(재실행 5/5) · `docker buildx build`(web, arm64) 결과는 PR 본문에 기록.
