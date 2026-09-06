# TrueWords 기술 문서

현재 작업은 M1~M4 이후 **앱별 UI 소유권 분리(사용자 승인 2안)**다. API SDK·ESLint·TypeScript 설정 3개 패키지는 유지한다. 사용자 승인 범위는 구현·검증·PR까지이며, 운영 배포·신규 디자인·PWA 신규 인증/푸시·Flutter 개발은 포함하지 않는다.

| 먼저 읽을 문서 | 용도 |
|---|---|
| [모노레포 설계](architecture/2026-09-05-pwa-flutter-monorepo.md) | web/admin/API 경계, 공통 API·인증·SSE·알림 정책 |
| [전환 실행 계획](plans/completed/2026-09-05-monorepo-migration.md) | M1~M4 범위와 실제 검증 증거, M5 제외 범위 |
| [앱별 UI 실행 계획](plans/active/2026-09-05-app-owned-ui.md) | 후속 2안 승인 범위와 재검증 증거 |
| [로컬 환경 설정](runbooks/environment-setup.md) | 앱별 실행과 환경변수 |
| [전환·복구 runbook](runbooks/monorepo-migration-and-rollback.md) | 로컬 볼륨 보존, 운영 origin·이미지·라우팅 전환 |
| [TODO](TODO.md) | 승인 대기 결정과 후속 작업 |

## 문서 책임

```text
docs/
├── prd/                 # 제품 배경·요구사항
├── specs/               # 공통 업무 동작 + 플랫폼별 인수 조건
│   ├── domain/          # 데이터 모델·도메인 정의
│   ├── api/             # API 동작 명세 (생성 계약은 루트 contracts/)
│   ├── web/             # 사용자 웹의 UI/UX 소유권·구현 기준
│   └── admin/           # 관리자 UI/UX 소유권·구현 기준
├── adr/                 # 장기 의사결정·보류 결정의 근거
├── architecture/        # 시스템 설계·문서 이전 manifest
├── plans/
│   ├── active/          # 현재 승인되어 실행하는 계획
│   └── completed/       # 실제 완료 증거를 첨부한 계획만 이동
├── runbooks/            # 개발·CI·운영·배포·복구
├── research/            # 시장/기술 조사, 실측, 외부 코드 분석
└── archive/             # 과거 계획·사고·종료된 체험단·폐기 설계
```

문서 ID와 파일명은 보존한다. PRD를 웹/모바일별로 복제하지 않고, 한 기능 spec에서 공통 규칙과 플랫폼별 동작을 구분한다. 과거 문서의 `backend/`, `admin/`, `src.*`와 실행 결과는 **당시 기록**이며 현재 명령의 근거로 사용하지 않는다.

web/admin의 UI·테마·화면 UX 명세는 앱별로 소유한다. 공통 업무 규칙을 복제하지 않으며, 현재 구현 기준을 기록했다는 이유로 새 디자인이 승인된 것으로 취급하지 않는다.

## 제품·기능 명세

| 문서 | 내용 |
|---|---|
| [01-project-overview](prd/01-project-overview.md) | 기존 제품 배경·데이터 범위 |
| [16-app-feature-spec](prd/16-app-feature-spec.md) | 이전 MVP/Flutter 구상. 신규 PWA 요구사항으로 자동 상속하지 않음 |
| [사용자 웹 UI/UX](specs/web/ui-ux.md), [관리자 UI/UX](specs/admin/ui-ux.md) | 현재 구현·소유권과 미승인 리디자인의 경계 |
| [17-chatbot-system-prompt-spec](specs/17-chatbot-system-prompt-spec.md) | 챗봇별 시스템 프롬프트 |
| [18-category-document-stats](specs/18-category-document-stats.md), [19-category-tag-management-ui](specs/19-category-tag-management-ui.md) | 문서 통계·카테고리 UI |
| [도메인 사전](specs/domain/06-terminology-dictionary-structure.md), [중복 업로드 API](specs/api/check_duplicate.md) | 용어 데이터 구조·업로드 동작 |

2026-03/04 날짜가 있는 `specs/`의 개별 설계는 당시 승인 상태를 유지한다. 과거 계획의 체크박스를 현재 완료 증거로 바꾸지 않는다. 미착수 Flutter/과거 Cloud Run 스펙은 `archive/specs/`에 분리했다.

## 아키텍처·결정

| 문서 | 내용 |
|---|---|
| [02-architecture-design](architecture/02-architecture-design.md), [05-rag-pipeline](architecture/05-rag-pipeline.md) | 기반 설계와 RAG 정책 |
| [07-multi-chatbot-version](architecture/07-multi-chatbot-version.md), [11-data-routing-strategies](architecture/11-data-routing-strategies.md) | 챗봇 조합·라우팅 |
| [08-semantic-cache](architecture/08-semantic-cache.md), [09-security-countermeasures](architecture/09-security-countermeasures.md) | 캐시·가드레일 설계 |
| [구조 다이어그램 7종](architecture/diagrams/README.md) | 현재 구조 (main `8980e0c`, 2026-09-06 재생성). 운영·레포·데이터·채팅·적재 2종·배포 워크플로. JSON 원본·HTML 뷰어·PNG. 분리 전 JSON 은 [archive](archive/diagrams-2026-09-04/) |
| [ADR 목록](adr/) | 기존 ADR 번호 유지. [Oracle 이전](adr/2026-07-25-gcp-to-oracle-migration.md), [HTTP/2 회피](adr/47-qdrant-sdk-http2-permanent-fix.md), [CI/CD 점검 결정](adr/2026-09-05-cicd-audit-decisions.md), [툴체인 최신화(pnpm 12·TS 6·Next 16.3)](adr/2026-09-06-toolchain-latest-decisions.md), [Biome 전환 결정(2026-09-06 확정 · P3 ①·② 완료)](adr/2026-09-06-biome-migration-proposal.md) 등 |

현재 앱의 위치와 실행 명령은 [루트 README](../README.md), 현재 설계는 [ARCH-MONO-001](architecture/2026-09-05-pwa-flutter-monorepo.md)을 우선한다. 과거 아키텍처 문서의 청사진·성능 수치는 이번 이전에서 재측정한 결과가 아니다.

## 개발·운영

| 문서 | 내용 |
|---|---|
| [environment-setup](runbooks/environment-setup.md) | pnpm/uv, 앱별 환경, 쿠키·볼륨 주의점 |
| [ci-cd-pipeline](runbooks/ci-cd-pipeline.md) | 변경 범위별 검증·독립 배포·필수 CI 집계 |
| [development-workflow](runbooks/development-workflow.md), [integration-branch-workflow](runbooks/integration-branch-workflow.md) | 작업·통합 브랜치 규칙 |
| [oracle-vm-migration](runbooks/oracle-vm-migration.md), [VM 운영 기준](../infra/oracle-vm/README.md) | 기존 Oracle 이전 이력·일상 운영 |
| [redteam-test-guide](runbooks/redteam-test-guide.md), [semantic-cache-cleanup](runbooks/semantic-cache-cleanup.md) | 과거 화면 기반 레드팀 가이드·캐시 운영 |

## 조사·이력

| 분류 | 읽을 자료 |
|---|---|
| 현재 PWA 제품 조사 | [초원AI 벤치마크](research/2026-08-30-chowon-ai-benchmark.md), [가정연합 PWA 방향](research/2026-08-30-pwa-app-direction.md), [검토 보고서](research/2026-08-31-chowon-pwa-strategy-report.html) |
| 기존 시장 전략 | [12](research/12-market-analysis.md), [13](research/13-competitor-deep-dive.md), [14](research/14-success-factors-strategy.md): 개신교/성경 앱 전제이며 FFWPU PRD로 자동 상속하지 않음 |
| 기존 디자인 조사 | [17-design-strategy](research/17-design-strategy.md): 과거 디자인 전략. 신규 PWA·관리자의 공통 디자인 승인 기준이 아님 |
| 기술·코드 조사 | [청킹/임베딩](research/19-rag-chunking-embedding-research.md), [로컬 LLM](research/15-local-llm-benchmark.md), [외부 코드 분석](research/insights/README.md) |
| 과거 계획·운영 기록 | [archive 설명](archive/README.md). 완료 여부를 이번 이전에서 새로 판정하지 않음 |
| 이전 감사 | [문서 이전 manifest](architecture/2026-09-05-document-migration-manifest.json): 모든 기존 문서/매체의 이전 전 SHA-256·새 위치·분류 이유 |

기존 색인에만 있고 기준 commit `59e3a59`에 원본이 없는 문서 3개(`03-vector-db-comparison`, `04-gemini-file-search-analysis`, `10-vibe-coding-and-pinecone-vs-qdrant`)는 새 색인의 링크에서 제외했다. 원본 복구 전 내용을 만들거나 다른 문서로 가장하지 않는다. 상세는 manifest의 `missingIndexSources`를 참조한다.

검증: 저장소 루트에서 `node tooling/checks/docs-links.mjs`. 로컬 Markdown/HTML 링크·앵커·매체 경로를 검사하며, 외부 사이트 접근이나 과거 명령의 실행 성공을 보증하지 않는다.
