# TrueWords Platform 작업 지침

## 시작과 소유권

- 대화·계획·문서는 한국어, 코드 이름·커밋 접두사는 영어, 주석은 한국어로 쓴다.
- 새 작업에서는 이 파일과 변경 대상 앱의 `AGENTS.md`를 읽고, 필요한 경우 `docs/README.md`에서 현재 명세를 찾는다. 오래된 계획의 완료 표시보다 현재 코드·테스트·운영 runbook을 우선한다.
- 사용자 웹은 `apps/web`, 관리자는 `apps/admin`, 업무 규칙·최종 권한 검사는 `apps/api`가 소유한다. 공유 패키지는 `packages/api-client-ts`, `packages/eslint-config`, `packages/typescript-config`뿐이다. 앱 간 UI·테마·CSS를 공유하지 않는다.
- FastAPI 라우트·Pydantic 모델이 API 원본이다. `contracts/openapi.json`과 생성 SDK를 직접 수정하지 않는다. SSE는 별도 이벤트 계약을 따른다.

## 변경 원칙

- 작업 범위와 성공 조건을 짧게 확인하고, 영향받는 코드만 수정한다. 불확실한 업무 규칙은 `[가정]` 또는 `[확인 필요]`로 표시한다.
- 코드에서 드러나는 동작과 완료 이력을 반복해서 문서화하지 않는다. 외부 계약·권한/제품 정책·운영/복구 절차·장기 결정의 이유가 달라질 때만 관련 문서를 갱신한다. 기능마다 계획 문서나 TODO 항목을 만들지 않는다.
- 버그는 재현 테스트, 복잡한 업무 규칙은 의미 있는 동작 테스트로 확인한다. 단순 변경에는 테스트를 관례적으로 추가하지 않는다.
- 네트워크 실패, 빈 응답, 타입 불일치, 권한 오류 등 실제로 가능한 경계 조건을 검토한다.
- 새 Flutter 앱과 SDK는 도입 결정 전 만들지 않는다. 폴더 이동만을 근거로 API URL·DB 스키마·RAG 정책을 변경하지 않는다.

## Git·운영

- `main`에 직접 커밋·푸시하지 않는다. `{type}/{short-description}` 브랜치와 PR을 쓴다. 커밋 접두사는 `feat`, `fix`, `refactor`, `docs`, `chore`, `test` 중 하나다.
- 커밋, 푸시, PR, 배포는 사용자가 승인한 범위에서만 진행한다. 단계별 승인 없이 묶어 실행하는 것은 사용자가 묶어서 요청한 경우에 한한다. 배포는 별도 승인 후 `make deploy-*` 경로를 사용한다.
- worktree에서는 Compose project·포트를 격리한다. 기존 PostgreSQL·Qdrant 볼륨을 삭제하거나 재초기화하지 않는다. `.worktreeinclude`는 Claude Code worktree의 무시 파일 복사용이며 일반 `git worktree add`에는 적용되지 않는다.
- 큰 통합 브랜치의 절차는 `docs/runbooks/integration-branch-workflow.md`를 따른다.

## 검증 경로

- 루트 의존성: `pnpm install --frozen-lockfile`. 앱별 검증은 각 앱의 `AGENTS.md`를 따른다.
- 저장소 검증: `make ci`, `node tooling/checks/docs-links.mjs`. E2E가 필요한 변경은 `make e2e`를 추가한다.
- 로컬 환경과 운영 절차: `docs/runbooks/environment-setup.md`, `infra/oracle-vm/README.md`.
