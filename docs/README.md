# TrueWords Platform - 기술 설계 문서

말씀 AI 챗봇 프로젝트의 아키텍처 설계, 기술 결정, 시장 조사 및 프로덕트 설계 문서입니다.

---

## 00_project/ — 프로젝트 개요

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [01-project-overview](./00_project/01-project-overview.md) | 프로젝트 배경, 팀 구성, 액션 아이템, 핵심 논의 | 요구사항, 데이터 범위 |

---

## 01_requirements/ — 기능 명세

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [16-app-feature-spec](./01_requirements/16-app-feature-spec.md) | MVP 기능 목록, 모듈별 스펙, 릴리스 계획 | 기능 스펙, 화면 목록 |

---

## 02_domain/ — 도메인 모델

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [06-terminology-dictionary-structure](./02_domain/06-terminology-dictionary-structure.md) | 대사전 데이터 구조 5가지 방안 비교, 추천 조합 | 용어사전, 컬렉션 설계 |

---

## 04_architecture/ — 시스템 설계

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [diagrams/](./04_architecture/diagrams/README.md) | **현재 운영 구조 다이어그램 6종** — 시스템 · 데이터 모델 · 레포 · 채팅 시퀀스 · 적재 데이터플로우 · 적재 상태 라이프사이클 (archify) | 다이어그램, 인터랙티브 HTML |
| [02-architecture-design](./04_architecture/02-architecture-design.md) | 전체 인프라 구조, 요청 처리 파이프라인, Qdrant 컬렉션 설계 | PostgreSQL, Qdrant, Gemini |
| [03-vector-db-comparison](./04_architecture/03-vector-db-comparison.md) | 10종 벡터DB 다차원 평가 (Qdrant 8.75/10 선정) | DB 선정 근거 |
| [04-gemini-file-search-analysis](./04_architecture/04-gemini-file-search-analysis.md) | Gemini File Search API 기능/한계, Context Caching, 비용 | Gemini, 비용 |
| [05-rag-pipeline](./04_architecture/05-rag-pipeline.md) | RAG 구조, 고도화 5방향, 말씀 시간 기준 정책 | RAG, 하이브리드 검색 |
| [07-multi-chatbot-version](./04_architecture/07-multi-chatbot-version.md) | A\|B 조합 구현, 우선순위 검색 (Cascading Search) | 챗봇 버전, 필터링 |
| [08-semantic-cache](./04_architecture/08-semantic-cache.md) | 시맨틱 캐시 전략, 비용/속도 분석 | 캐시, 비용 절감 |
| [09-security-countermeasures](./04_architecture/09-security-countermeasures.md) | 악의적 사용 대응 9가지, 단계적 공개 | 보안, 가드레일 |
| [10-vibe-coding-and-pinecone-vs-qdrant](./04_architecture/10-vibe-coding-and-pinecone-vs-qdrant.md) | Pinecone과 Qdrant 상세 비교 | DB 비교 |
| [11-data-routing-strategies](./04_architecture/11-data-routing-strategies.md) | 데이터 소스 선택/라우팅 20가지 전략 | 라우팅, 검색 전략 |

---

## dev-log/ — 조사 및 의사결정 기록

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [12-market-analysis](./dev-log/12-market-analysis.md) | 글로벌 종교 AI 플랫폼 시장 조사 | 경쟁 현황, 시장 기회 |
| [13-competitor-deep-dive](./dev-log/13-competitor-deep-dive.md) | Hallow·초원 기능 스펙, 비즈니스 모델 비교 | Hallow, 초원 |
| [14-success-factors-strategy](./dev-log/14-success-factors-strategy.md) | 4대 성공 요인, 차별화 포지셔닝 | 전략, MVP 로드맵 |
| [15-local-llm-benchmark](./dev-log/15-local-llm-benchmark.md) | 13개 로컬 LLM 성능/품질 비교 | LLM, Spec Decoding |
| [17-design-strategy](./dev-log/17-design-strategy.md) | UI/UX 디자인 전략 (초안, 고도화 필요) | 디자인, 컬러, 화면 |
| [18-ai-rules-update-plan](./dev-log/18-ai-rules-update-plan.md) | .ai/rules 수정 계획 | 규칙 업데이트 |

---

## research/ — 제품·시장 조사

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [2026-08-30-chowon-ai-benchmark](./research/2026-08-30-chowon-ai-benchmark.md) | 초원AI의 현재 기능·공개 실제 화면·수익화·신뢰 리스크 교차 조사 | 초원AI, 경쟁 분석, 화면 |
| [2026-08-30-pwa-app-direction](./research/2026-08-30-pwa-app-direction.md) | FFWPU 독립 베타의 포지셔닝·MVP·Web Push 타당성·16개 세션 로드맵과 후속 프롬프트 | PWA, 제품 전략, 알림 |
| [2026-08-31-chowon-pwa-strategy-report](./research/2026-08-31-chowon-pwa-strategy-report.html) | 벤치마크와 제품 방향을 한 화면에서 검토하는 자체 포함 HTML 보고서 | 의사결정 보고서, 비교 차트 |

> 위 PWA 방향은 세션 0에서 승인됐으며, 기존 `faith-union-app` 프로토타입 및 Flutter Phase 4 기능 명세와 별개다.

---

## 05_env/ — 환경 설정

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [environment-setup](./05_env/environment-setup.md) | 로컬/스테이징/프로덕션 환경 설정, 환경변수 레퍼런스 | 개발환경, Docker Compose |

---

## 06_devops/ — CI/CD 파이프라인

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [ci-cd-pipeline](./06_devops/ci-cd-pipeline.md) | GitHub Actions CI(테스트) + cron, `make deploy-backend` 수동 배포, 롤백 | CI/CD, 배포, 롤백 |

---

## 07_infra/ — 인프라 구성

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [oracle-vm-migration](./07_infra/oracle-vm-migration.md) | GCP → Oracle Cloud ARM VM 이전 절차와 실행 기록 (2026-07-29 완료) | Oracle, 이전, Cloudflare Tunnel |
| [`infra/oracle-vm/README.md`](../infra/oracle-vm/README.md) | **일상 운영 기준 문서** — compose 구성, 배포·롤백, 백업·복구, 트러블슈팅 | 운영, 배포, 백업 |

---

## archive/ — 폐기 문서 (이력 보존)

GCP → Oracle 이전(2026-07-29)으로 무효가 된 문서들이다. 현재 인프라를 설명하지 않으니 참고만 한다.

| 문서 | 폐기 사유 |
|------|-----------|
| [gcp-vercel-infrastructure](./archive/gcp-vercel-infrastructure.md) | Cloud Run URL·리전·월 비용 전부 무효 |
| [qdrant-self-hosting](./archive/qdrant-self-hosting.md) | GCP VM Qdrant 전제 |
| [staging-separation](./archive/staging-separation.md) | GCP staging 전제, 미실행 계획 |
| [gcloud-infra-setup](./archive/gcloud-infra-setup.md) | gcloud CLI 셋업 가이드 |

---

## guides/ — 개발 가이드

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [development-workflow](./guides/development-workflow.md) | 개발 워크플로우 (gstack + superpowers + ai-rules), 작업 유형별 프로세스, 현재 진행 상태 | 워크플로우, 방법론, 다음 작업 |

---

## 핵심 아키텍처 결정

```
Next.js 16 (Web 채팅 + Admin 단일 앱) + FastAPI (백엔드) + Qdrant (검색) + PostgreSQL (운영) + Gemini 3.5 Flash Lite (생성) / gemini-embedding-001 (임베딩)
```

- **Qdrant**: 종합 평가 8.75/10으로 선정 (10종 비교)
- **Gemini File Search**: 단독 사용 비추 (4.85/10), 생성 모델 + Context Caching으로 활용
- **배포**: Oracle Cloud ARM VM 단일 노드 — admin · backend · Qdrant · PostgreSQL · Cloudflare Tunnel 5 컨테이너 (2026-07-29 GCP/Vercel 에서 이전)
- **운영 비용**: 인프라 $0 (Oracle Always Free) + Gemini API 사용량

## 문서 간 참조 관계

```
개발 지시 시 참조 가이드:

AI 챗봇 개발   → 04_architecture/02 + 04_architecture/05 + 01_requirements/16
검색 기능 개발 → 04_architecture/05 + 04_architecture/11 + 04_architecture/07
보안/가드레일  → 04_architecture/09 + dev-log/12
UI/프론트엔드  → 01_requirements/16 + dev-log/17 + dev-log/13
캐싱/비용 최적화 → 04_architecture/08 + 04_architecture/04
전략/기획 논의 → dev-log/12 + dev-log/14 + 00_project/01
신규 가정연합 PWA → research/2026-08-30-pwa-app-direction + research/2026-08-30-chowon-ai-benchmark
로컬 LLM 활용  → dev-log/15
```

> `dev-log/12~14`는 개신교·성경 앱 시장을 전제로 한 기존 벤치마크다. 신규 가정연합 PWA의 요구사항으로 상속하지 않는다.
