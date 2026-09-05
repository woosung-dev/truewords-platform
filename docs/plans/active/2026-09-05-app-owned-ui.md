# APP-UI-001 — 앱별 UI 소유권 분리

- 상태: 사용자 **2안 승인**, 구현·로컬 검증 완료. 2026-09-05 **커밋·푸시 명시 승인**, 새 HEAD 원격 검증은 별도 단계다.
- 기준: PR #221, `896a7ae`. [현재 모노레포 설계](../../architecture/2026-09-05-pwa-flutter-monorepo.md)의 공통 UI 범위를 이번 승인으로 변경한다.
- 목표: web/admin UI·테마·UX 문서는 앱별 소유. `api-client-ts`, `eslint-config`, `typescript-config`만 공유 패키지로 유지한다.

## 범위와 보존 기준

1. 공용 UI 17개 중 양앱 사용 6개는 각 앱으로 복사한다. admin 전용 6개와 web 전용 4개는 소비 앱으로 이동한다. 기존부터 미사용인 Separator는 원래 소유 앱인 admin에 보존하며 별도 정리하지 않는다.
2. 앱별 `src/lib/utils.ts`, `src/components/ui`, `src/app/globals.css`로 import·CSS·테마를 분리한다. CSS 값·컴포넌트 동작은 보존하며 실제 단독 사용 스타일만 소유 앱으로 옮긴다. 공통 토큰 값이 현재 같다는 이유로 새 토큰/유틸 패키지를 만들지 않는다.
3. 패키지 의존성·lockfile·shadcn aliases·Next 설정·Docker/CI·경계 검사를 갱신한다. API 계약·인증·SSE·라우트는 변경하지 않는다.
4. 현재 구현의 UI/UX 소유권을 앱별 spec에 기록한다. 신규 PWA 디자인 확정·리디자인·Flutter·서비스워커/알림 구현은 범위 밖이다.

## 작업과 검증

| 작업 | 담당 경계 | 완료 기준 |
|---|---|---|
| UI·CSS·import 이전 | `apps/web`, `apps/admin` 소스·앱 설정 | typecheck, lint, 양앱 Vitest, UI 소스/스타일 보존 확인 |
| 패키지 제거·실행 연결 | `packages/ui-web`, root lock, tooling, infra, E2E | frozen install, 경계 검사, 양앱 build·이미지 smoke, 회귀 E2E |
| 문서·지침 갱신 | README, AGENTS, 활성 설계/규칙, 앱별 UX spec | 현재 소유권 일치, docs 링크 검사 |

프론트와 문서는 병렬 진행했고, 앱 소스 이전 뒤 공용 패키지 제거·lockfile 갱신 및 통합 검증을 수행했다. Dockerfile/CI의 기존 `apps`·`packages` 복사/영향 범위는 유지해도 동작하므로 불필요하게 수정하지 않았다.

## 회귀 확인

- 기존 로그인·채팅·관리자 화면, light/dark·모바일 뷰포트·Portal 색상·키보드 조작을 확인한다.
- 이전 이미지/소스와 비교해 UI 값·동작을 보존하고, Tailwind 스캔 경로 변경에 따른 CSS 누락을 검사한다.
- 앱 간 import 및 CSS 외부 참조를 막는 회귀 테스트를 추가한다. API/생성 계약은 변경이 없는지 확인한다.
- PR 반영은 운영 배포·main 병합을 포함하지 않는다. Vercel preview는 2026-09-05 프로젝트 삭제 결정으로 더 이상 검증 대상이 아니다(과거 기록의 `apps/admin` override는 당시 상태다).

## 완료 증거

아래 결과는 `896a7ae` 위의 UI 분리 변경을 **커밋하기 전 로컬에서** 실행했다. PR #221의 이전 CI·Vercel preview는 당시 HEAD의 증거이며, 이번 UI 분리 변경의 원격 검증으로 간주하지 않는다.

| 검증 | 이번 실행 결과 |
|---|---|
| 의존성·정적 검사 | `pnpm install --frozen-lockfile`, `pnpm typecheck`, 새 E2E 파일 strict TypeScript 검사 통과. `pnpm lint` 오류 0, 기존 web `useCallback` 경고 1개 유지. 의존성 버전 추가/업그레이드 없음 |
| 단위·경계 검사 | `pnpm test` **152개** 통과(admin 76, web 63, SDK 13). `pnpm tooling:test` **15개** 통과. 앱 간 UI/CSS 및 제거한 패키지 참조를 검사하며, 끝에 `/` 없는 Tailwind 디렉터리 참조도 회귀 입력에 포함 |
| 이미지 빌드·실행 | web/admin production Docker 이미지 빌드 성공, 두 컨테이너 UID 1001. 로그인·정적 CSS·프록시 health 200, CSRF 거부 403, 기존 API alias 응답 동등, SSE 점진 전달·취소 확인 |
| 브라우저·화면 보존 | 새 이미지에서 E2E **38개** 통과(retries 0). 변경 전후 이미지 각각 UI 회귀 4개 통과. 같은 DB·Chromium·390×844에서 web/admin × light/dark Portal 스크린샷 4쌍의 RGBA 픽셀 차이 **0개** |
| 문서·변경 범위 | 문서 174개/로컬 링크 204개 검사 및 `git diff --check` 통과. `apps/api`, `contracts`, 남긴 공유 패키지 3개의 파일 변경 없음 |

### 소스 보존 확인

- 앱별로 배치한 UI/유틸 25개 파일은 import 경로를 정규화하면 이전 원본과 일치한다. 기존 TS/TSX 소비 파일 46개도 import 경로 외의 변경이 없다.
- 기존 CSS 선언 297개 중 web은 233개, admin은 223개를 유지했다. 유지 선언의 값·`!important`·selector/at-rule 문맥·순서 차이는 0개다. 반대 앱 전용 스타일만 제외하며 판단이 불확실한 토큰은 보존했다.
- `packages/ui-web` 코드·설정 23개 파일은 제거하고 앱별 경로에 코드를 보존했다. 미사용 Separator도 admin에 보존했다. ignored 캐시는 `/tmp/truewords-ui-split-evidence.v6a2DA/retired-ui-package-cache`로 옮겨 복구 가능하다.

### 재현과 증거 위치

브라우저 테스트에는 [E2E 실행 안내](../../../tests/e2e/README.md)의 격리 DB·fixture API를 사용했다. 외부 LLM 호출·운영 데이터 변경은 없다.

```bash
E2E_EXTERNAL_SERVERS=1 \
E2E_WEB_ORIGIN=http://127.0.0.1:13000 \
E2E_ADMIN_ORIGIN=http://localhost:13001 \
E2E_API_ORIGIN=http://127.0.0.1:18000 \
pnpm test:e2e
```

- 새 이미지: `truewords-web:app-owned-ui` (`8ec459125807`), `truewords-admin:app-owned-ui` (`d99ae549ac7f`). 이전 비교 이미지는 `truewords-{web,admin}:monorepo-smoke`.
- 로컬 화면 증거: `/tmp/truewords-ui-split-evidence.v6a2DA/{before-visual,after-visual}`. 새 테스트도 `test-results`에 PNG를 저장한다. 임시 파일은 저장소/CI의 영구 증거가 아니며, 픽셀 비교 결과는 위 실행 조건의 네 화면에 한정한다.
- 검증 후 이번 작업의 프론트 컨테이너 4개·fixture API·전용 DB/Qdrant Compose를 종료/제거했다. tmpfs 테스트 데이터는 폐기했고 seed로 재생성 가능하다. 기존 개발/운영 볼륨은 건드리지 않았으며 이미지·화면 증거는 보존했다. Turbo가 main worktree에 생성한 캐시도 증거 디렉터리의 `main-worktree-turbo-cache`로 옮겨 main의 기존 변경 상태를 복원했다.

### 남은 단계와 검증 한계

1. 2026-09-05 사용자가 커밋·푸시를 함께 승인했다. 대상은 PR #221의 `refactor/monorepo-platform` 브랜치다. 새 HEAD의 원격 검증은 별도로 확인하고, 배포 결과 모니터링은 추가 승인 후 진행한다. 전역 Vercel root 변경·main 병합·운영 배포는 하지 않았다.
2. 전체 API pytest는 이번 UI 전용 변경에서 다시 실행하지 않았다. API 파일 무변경 확인과 실제 격리 API를 사용하는 통합 시나리오로 연결부를 검증했다.
3. 전체 화면/브라우저의 시각·접근성 검증, iPhone PWA 설치·푸시 실기기 검증은 이번 증거에 포함하지 않는다. 앱별 UI/UX spec은 현재 구현의 책임을 기록하며 신규 제품 디자인 승인을 대신하지 않는다.
