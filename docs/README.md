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

## 핵심 아키텍처 결정

```
Flutter (프론트엔드) + FastAPI (백엔드) + Qdrant (검색) + PostgreSQL (운영) + Gemini 2.5 (생성)
```

- **Qdrant**: 종합 평가 8.75/10으로 선정 (10종 비교)
- **Gemini File Search**: 단독 사용 비추 (4.85/10), 생성 모델 + Context Caching으로 활용
- **예상 월 비용**: ~$105-215/월

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
