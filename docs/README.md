# TrueWords 문서

현재 동작과 실행 명령은 [루트 README](../README.md)와 코드가 우선한다. 이 디렉터리에는 코드만으로 알기 어려운 제품·권리 규칙, 결정 이유, 운영 절차를 둔다. 완료 체크리스트와 세션 기록은 Git/PR 이력으로 확인한다.

| 찾는 내용 | 위치 |
|---|---|
| 훈독 제품 범위·권리 | [PRD](prd/17-ffwpu-pwa-prd.md), [도메인](specs/domain/hoondok-entities.md), [API](specs/api/hoondok-api.md) |
| 웹·관리자 화면 기준 | [훈독 디자인](specs/web/hoondok-design-system.md), [웹](specs/web/ui-ux.md), [관리자](specs/admin/ui-ux.md) |
| 시스템 경계·기술 결정 | [모노레포 설계](architecture/2026-09-05-pwa-flutter-monorepo.md), [ADR](adr/) |
| 개발·배포·복구 | [환경 설정](runbooks/environment-setup.md), [CI/CD](runbooks/ci-cd-pipeline.md), [훈독 롤아웃](runbooks/hoondok-pwa-rollout.md), [Oracle VM](../infra/oracle-vm/README.md) |
| 남은 결정·운영 작업 | [TODO](TODO.md) |

`plans/active/`의 기존 계획은 진행 중인 트랙의 범위와 인수 조건을 확인할 때만 사용한다. `plans/completed/`, `archive/`, 오래된 `research/` 자료는 당시의 기록이며 현재 운영 상태나 테스트 결과를 뜻하지 않는다. 과거 기록은 필요한 근거가 남은 것만 유지하고, 제거한 자료는 Git 이력에서 찾는다.

문서를 새로 쓸 때는 **코드·테스트·이슈로 설명할 수 없는 정보만** 추가한다. 코드 변경마다 문서를 의무적으로 갱신하지 않는다. 현재 계약이나 운영 절차가 바뀌면 그 소유 문서만 수정한다.

링크 검사: `node tooling/checks/docs-links.mjs`
