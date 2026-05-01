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
| [17-chatbot-system-prompt-spec](./01_requirements/17-chatbot-system-prompt-spec.md) | 챗봇별 시스템 프롬프트 관리 명세 | 시스템 프롬프트, 페르소나 |
| [18-category-document-stats](./01_requirements/18-category-document-stats.md) | 카테고리별 문서/청크 현황 표시 기능 | 데이터소스, 카테고리 통계 |
| [19-category-tag-management-ui](./01_requirements/19-category-tag-management-ui.md) | 문서 카테고리 태그 관리 UI | Transfer UI, 다중 태그 |

---

## 02_domain/ — 도메인 모델

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [06-terminology-dictionary-structure](./02_domain/06-terminology-dictionary-structure.md) | 대사전 데이터 구조 5가지 방안 비교, 추천 조합 | 용어사전, 컬렉션 설계 |

---

## 03_api/ — API 명세

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [check_duplicate](./03_api/check_duplicate.md) | 업로드 전 중복 문서 확인 및 재업로드 정책 API | 업로드, 중복 확인, on_duplicate |

---

## 04_architecture/ — 시스템 설계

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [02-architecture-design](./04_architecture/02-architecture-design.md) | 전체 인프라 구조, 요청 처리 파이프라인, Qdrant 컬렉션 설계 | PostgreSQL, Qdrant, Gemini |
| [03-vector-db-comparison](./04_architecture/03-vector-db-comparison.md) | 10종 벡터DB 다차원 평가 (Qdrant 8.75/10 선정) | DB 선정 근거 |
| [04-gemini-file-search-analysis](./04_architecture/04-gemini-file-search-analysis.md) | Gemini File Search API 기능/한계, Context Caching, 비용 | Gemini, 비용 |
| [05-rag-pipeline](./04_architecture/05-rag-pipeline.md) | RAG 구조, 고도화 5방향, 말씀 시간 기준 정책 | RAG, 하이브리드 검색 |
| [07-multi-chatbot-version](./04_architecture/07-multi-chatbot-version.md) | A\|B 조합 구현, 우선순위 검색 (Cascading Search) | 챗봇 버전, 필터링 |
| [08-semantic-cache](./04_architecture/08-semantic-cache.md) | 시맨틱 캐시 전략, 비용/속도 분석 | 캐시, 비용 절감 |
| [09-security-countermeasures](./04_architecture/09-security-countermeasures.md) | 악의적 사용 대응 9가지, 단계적 공개 | 보안, 가드레일 |
| [10-vibe-coding-and-pinecone-vs-qdrant](./04_architecture/10-vibe-coding-and-pinecone-vs-qdrant.md) | Pinecone과 Qdrant 상세 비교 | DB 비교 |
| [11-data-routing-strategies](./04_architecture/11-data-routing-strategies.md) | 데이터 소스 선택/라우팅 20가지 전략 | 라우팅, 검색 전략 |
| [redteam-test-plan](./04_architecture/redteam-test-plan.md) | 프롬프트 인젝션/안전성 레드팀 테스트 계획 | 보안 검증 |
| [target-architecture-blueprint-2026-05-01](./04_architecture/target-architecture-blueprint-2026-05-01.html) | 외부 Target Architecture 청사진 사본 | 아키텍처 비교, 참고 자료 |

---

## dev-log/ — 조사 및 의사결정 기록

> 전체 dev-log는 날짜/번호 기반 ADR입니다. 아래 표는 현재 개발 방향에 직접 영향을 주는 핵심 문서만 색인합니다.

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [12-market-analysis](./dev-log/12-market-analysis.md) | 글로벌 종교 AI 플랫폼 시장 조사 | 경쟁 현황, 시장 기회 |
| [13-competitor-deep-dive](./dev-log/13-competitor-deep-dive.md) | Hallow·초원 기능 스펙, 비즈니스 모델 비교 | Hallow, 초원 |
| [14-success-factors-strategy](./dev-log/14-success-factors-strategy.md) | 4대 성공 요인, 차별화 포지셔닝 | 전략, MVP 로드맵 |
| [15-local-llm-benchmark](./dev-log/15-local-llm-benchmark.md) | 13개 로컬 LLM 성능/품질 비교 | LLM, Spec Decoding |
| [17-design-strategy](./dev-log/17-design-strategy.md) | UI/UX 디자인 전략 (초안, 고도화 필요) | 디자인, 컬러, 화면 |
| [18-ai-rules-update-plan](./dev-log/18-ai-rules-update-plan.md) | .ai/rules 수정 계획 | 규칙 업데이트 |
| [24-rrf-score-threshold-fix](./dev-log/24-rrf-score-threshold-fix.md) | RRF 점수 스케일 불일치 수정 | RRF, threshold |
| [26-source-label-decision](./dev-log/26-source-label-decision.md) | source 라벨 체계 결정 | 데이터 라벨, 카테고리 |
| [30-upload-on-duplicate-mode](./dev-log/30-upload-on-duplicate-mode.md) | 재업로드 정책 `merge|replace|skip` | 업로드, 중복 처리 |
| [43-r1-phase3-completion](./dev-log/43-r1-phase3-completion.md) | Chat pipeline Stage/FSM 리팩토링 완료 | Pipeline Stage, FSM |
| [44-rag-intent-routing-and-eval](./dev-log/44-rag-intent-routing-and-eval.md) | Intent routing + RAG 평가 | Intent, RAG 품질 |
| [45-paragraph-chunking-50q-revalidation](./dev-log/45-paragraph-chunking-50q-revalidation.md) | paragraph 청킹 50문항 재검증 | 청킹, 평가 |
| [45-qdrant-self-hosting](./dev-log/45-qdrant-self-hosting.md) | Qdrant 셀프 호스팅 결정 | Qdrant VM, Cloudflare Tunnel |
| [46-qdrant-cache-cold-start-debug](./dev-log/46-qdrant-cache-cold-start-debug.md) | Qdrant cache cold start 진단 | Semantic Cache, raw HTTP |
| [47-qdrant-sdk-http2-permanent-fix](./dev-log/47-qdrant-sdk-http2-permanent-fix.md) | qdrant-client HTTP/2 hang 영구 회피 | RawQdrantClient |
| [51-recursive-v5-88vol-promotion](./dev-log/51-recursive-v5-88vol-promotion.md) | Recursive v5 88권 운영 채택 | 청킹 운영 전환 |
| [52-collection-main-deprecation](./dev-log/52-collection-main-deprecation.md) | 봇별 `collection_main` 토글 폐기 | 단일 컬렉션 운영 |
| [53-metadata-filter-poc](./dev-log/53-metadata-filter-poc.md) | 메타데이터 필터 PoC | volume/date filter |
| [54-chunking-hierarchical-contextual-poc](./dev-log/54-chunking-hierarchical-contextual-poc.md) | Hierarchical/Contextual Retrieval PoC 보류 결정 | 청킹 PoC |
| [2026-05-01-cascade-threshold-paths](./dev-log/2026-05-01-cascade-threshold-paths.md) | Cascading threshold 설정 전파 경로 조사 | score_threshold |
| [2026-05-01-target-architecture-gap](./dev-log/2026-05-01-target-architecture-gap.md) | Target Architecture 청사진과 실제 코드 차이 | 아키텍처 gap |

---

## 05_env/ — 환경 설정

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [environment-setup](./05_env/environment-setup.md) | 로컬/스테이징/프로덕션 환경 설정, 환경변수 레퍼런스 | 개발환경, Docker Compose |

---

## 06_devops/ — CI/CD 파이프라인

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [ci-cd-pipeline](./06_devops/ci-cd-pipeline.md) | GitHub Actions CI/CD, Cloud Run 배포, Vercel 연동 | CI/CD, 배포, 롤백 |

---

## 07_infra/ — 인프라 구성

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [gcp-vercel-infrastructure](./07_infra/gcp-vercel-infrastructure.md) | GCP Cloud Run + Vercel 인프라, 리소스 구성, 월 비용 | 클라우드, 아키텍처, 비용 |
| [qdrant-self-hosting](./07_infra/qdrant-self-hosting.md) | Qdrant VM 셀프 호스팅 운영 가이드 | Qdrant, Cloudflare Tunnel |
| [staging-separation](./07_infra/staging-separation.md) | Staging 환경 분리 설계 | staging, Cloud Run, Vercel |

---

## guides/ — 개발 가이드

| 문서 | 설명 | 키워드 |
|------|------|--------|
| [development-workflow](./guides/development-workflow.md) | 개발 워크플로우 (gstack + superpowers + ai-rules), 작업 유형별 프로세스, 현재 진행 상태 | 워크플로우, 방법론, 다음 작업 |
| [integration-branch-workflow](./guides/integration-branch-workflow.md) | 통합 브랜치/stack PR 운영 가이드 | git worktree, PR flow |
| [redteam-test-guide](./guides/redteam-test-guide.md) | 레드팀 테스트 수행 가이드 | QA, 안전성 검증 |

---

## 핵심 아키텍처 결정

```
Flutter (프론트엔드) + FastAPI (백엔드) + Qdrant (검색) + PostgreSQL (운영) + Gemini 2.5 (생성)
```

- **Qdrant**: 종합 평가 8.75/10으로 선정 (10종 비교)
- **Gemini File Search**: 단독 사용 비추 (4.85/10), 생성 모델 + Context Caching으로 활용
- **배포**: Vercel (admin) + GCP Cloud Run (백엔드)
- **검색 컬렉션**: `settings.collection_name` 단일 메인 컬렉션 운영 (`malssum_poc_v5` 기본값)
- **Semantic Cache**: 운영 기본 임계값 `CACHE_THRESHOLD=0.88`, TTL 7일, chatbot_id 격리
- **예상 월 비용**: ~$66-210/월

## 문서 간 참조 관계

```
개발 지시 시 참조 가이드:

AI 챗봇 개발   → 04_architecture/02 + 04_architecture/05 + 01_requirements/16
검색 기능 개발 → 04_architecture/05 + 04_architecture/11 + 04_architecture/07
보안/가드레일  → 04_architecture/09 + dev-log/12
UI/프론트엔드  → 01_requirements/16 + dev-log/17 + dev-log/13
캐싱/비용 최적화 → 04_architecture/08 + 04_architecture/04
전략/기획 논의 → dev-log/12 + dev-log/14 + 00_project/01
로컬 LLM 활용  → dev-log/15
```
