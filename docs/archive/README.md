# 과거 문서 보관

이 디렉터리는 **현재 실행 계획이 아니다**. 문서 내부의 승인/완료 상태, 코드 경로, 명령과 측정값은 작성 시점 그대로 보존했다. 새 구현에 재사용하려면 현재 [모노레포 설계](../architecture/2026-09-05-pwa-flutter-monorepo.md)와 코드에 대조한다.

| 경로 | 보존 이유 |
|---|---|
| `plans/` | 과거 구현 계획과 미확정 제안. 체크박스만으로 완료를 선언하지 않음 |
| `specs/` | 미착수 Flutter 우선 설계와 이전 Cloud Run 인프라 구상 |
| `engineering/` | 사고·정적 조사·PR 결과처럼 시점에 종속되는 기록 |
| `beta-2026/` | 종료된 체험단의 설문·HTML 보고서, 상호 참조 묶음 유지 |
| `superpowers/`, `dev-log/`, 루트의 GCP 관련 파일 | 이미 보관/폐기했던 원본과 옛 환경 가이드 |
| `diagrams-2026-09-04/` | 분리 전(통합 admin/backend, main `94755c7`) archify 다이어그램 6종의 JSON 원본. 당시 HTML/PNG 는 git 이력(`5cb30b5` 이전 `docs/architecture/diagrams/`)에 있고, 현재 구조 그림은 [architecture/diagrams](../architecture/diagrams/README.md) |

`plans/completed/`로 옮기지 않은 것은 실패 판정이 아니라 **현재 완료 증거를 다시 확인하지 않았기 때문**이다. 기존 문서 번호와 파일별 이전 위치는 [manifest](../architecture/2026-09-05-document-migration-manifest.json)에 기록했다.
