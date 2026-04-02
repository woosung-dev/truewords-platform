# 개발 워크플로우 가이드

> **"다음에 뭘 해야 하지?"** 할 때 이 문서를 보세요.

---

## 1. 전체 개발 사이클

세 가지 도구가 역할을 나눠 담당합니다:

| 도구 | 역할 | 언제 |
|------|------|------|
| **gstack** | 전문가 관점 부여 (CEO, 디자이너, 엔지니어, 보안) | 기획·리뷰·배포 |
| **superpowers** | 구현 워크플로우 강제 (Brainstorm → Plan → TDD) | 코드 작성 |
| **ai-rules** (`.ai/rules/`) | 코딩 컨벤션, 아키텍처 패턴 | 항상 |

---

## 2. 새로운 기능 개발 시 워크플로우

```
Phase 1: 기획 (gstack)
──────────────────────────────────────
/office-hours          문제 정의, 요구사항 정리, 방향 설정
       ↓
/plan-ceo-review       CEO 관점 — 스코프, 제품 비전, 우선순위
       ↓
/plan-eng-review       엔지니어링 관점 — 아키텍처, 데이터 흐름, 기술 결정
       ↓
/plan-design-review    디자인 관점 — UI/UX, 화면 설계 (해당 시)

Phase 2: 구현 (superpowers)
──────────────────────────────────────
/brainstorm            아이디어 정리, 설계 탐색
       ↓
Plan Mode              구현 계획 작성 → docs/에 문서 저장
       ↓
사용자 리뷰             계획 확인/수정
       ↓
구현                    코드 작성 (TDD 또는 직접 구현)

Phase 3: 검증 (gstack + superpowers)
──────────────────────────────────────
/review                코드 리뷰 (PR 수준 점검)
       ↓
/qa                    QA 테스트 (기능 동작 확인)
       ↓
/cso                   보안 검토 (민감 기능일 때)

Phase 4: 배포
──────────────────────────────────────
/ship                  릴리스 체크리스트, PR 생성, 배포
       ↓
커밋/푸쉬               사용자 승인 후 진행 (Git Safety Protocol)
```

---

## 3. 작업 유형별 축약 워크플로우

모든 작업이 풀 사이클을 필요로 하지는 않습니다.

### 큰 기능 (새로운 모듈, DB 설계 등)

```
/office-hours → /plan-eng-review → /brainstorm → Plan → 구현 → /review → /qa → /ship
```

### 기존 기능 개선/확장

```
/brainstorm → Plan → 구현 → /review → /ship
```

### 버그 수정

```
/investigate → 수정 → /review → /ship
```

### UI/프론트엔드 작업

```
/office-hours → /plan-design-review → /brainstorm → 구현 → /design-review → /qa → /ship
```

### 보안 관련 작업

```
/cso → 수정 → /review → /ship
```

---

## 4. 주요 gstack 커맨드 + 프로젝트 참조 문서

| 커맨드 | 역할 | 참조 문서 |
|--------|------|-----------|
| `/office-hours` | 기획 브레인스토밍 | 작업에 따라 다름 |
| `/plan-ceo-review` | CEO 관점 리뷰 | `docs/dev-log/14-success-factors-strategy.md`, `docs/dev-log/12-market-analysis.md` |
| `/plan-eng-review` | 엔지니어링 리뷰 | `docs/04_architecture/02-architecture-design.md`, `docs/04_architecture/05-rag-pipeline.md` |
| `/plan-design-review` | 디자인 리뷰 | `docs/dev-log/17-design-strategy.md`, `docs/01_requirements/16-app-feature-spec.md` |
| `/review` | 코드 리뷰 | `.ai/rules/backend.md`, `.ai/rules/rag-pipeline.md` |
| `/qa` | QA 테스트 | `docs/01_requirements/16-app-feature-spec.md` |
| `/cso` | 보안 검토 | `docs/04_architecture/09-security-countermeasures.md` |
| `/investigate` | 버그 원인 분석 | - |
| `/ship` | 릴리스/배포 | - |
| `/browse` | 실제 웹 테스트 | - |

---

## 5. 프롬프트 작성 가이드

gstack 커맨드 실행 시 아래 구조로 프롬프트를 작성하면 효과적입니다:

```
/<커맨드>

<프로젝트명>에서 <작업 내용>을 하려 합니다.

## 현재 상태
- 완료된 것
- 진행 중인 것

## 참조 문서
- 관련 아키텍처/설계 문서 경로

## 고민 사항
1. 결정이 필요한 질문들
```

---

## 6. 현재 프로젝트 진행 상태

### 완료

| 항목 | 커밋 | 상태 |
|------|------|------|
| Qdrant 컬렉션 생성 | `32ef8dc` | Done |
| 텍스트 청킹 (단락 기반, 오버랩) | `208fccb` | Done |
| Gemini dense + BM25 sparse 임베딩 | `de4ecaf` | Done |
| Qdrant 청크 적재 파이프라인 | `233805a` | Done |
| RRF 하이브리드 검색 | `8feb312` | Done |
| 시스템 프롬프트 + Gemini 답변 생성 | `4b2cb35` | Done |
| POST /chat 엔드포인트 | `20b6786` | Done |
| 데이터 적재 + RAG 품질 평가 | `0c1493a` | Done |
| google-genai 마이그레이션 | `2228852` | Done |
| source 필터 + Cascading Search | `4e7d46b` | Done |
| 다중 챗봇 (chatbot_id) 지원 | `4e7d46b` | Done |

### 미완료 (우선순위 순)

| 우선순위 | 항목 | 설계 문서 | 비고 |
|----------|------|-----------|------|
| **P0** | PostgreSQL 운영 DB (유저, 대화이력, 설정) | 스키마 설계 필요 | 다음 작업 |
| **P0** | 관리자 페이지 (MVP 범위 정의 필요) | 요구사항 정의 필요 | |
| **P1** | 종교 용어 사전 동적 주입 | `docs/02_domain/06-terminology-dictionary-structure.md` | |
| **P1** | Semantic Cache | `docs/04_architecture/08-semantic-cache.md` | |
| **P1** | 보안/가드레일 | `docs/04_architecture/09-security-countermeasures.md` | |
| **P2** | Flutter 프론트엔드 | `docs/01_requirements/16-app-feature-spec.md` | |
| **P2** | SSE 스트리밍 응답 | 기능 스펙 M-01 | |

### 다음 작업 시작 방법

```bash
# PostgreSQL 운영 DB 설계 시작
/office-hours

# 아래 프롬프트 사용:
# "TrueWords 프로젝트에서 PostgreSQL 운영 DB 스키마 설계를 시작하려 합니다.
#  현재 RAG 파이프라인은 완성, 유저/대화이력/챗봇설정 DB가 없는 상태입니다.
#  참조: docs/04_architecture/02-architecture-design.md
#  고민: MVP 범위, 인증 방식, 관리자 페이지 필요 여부"
```

---

## 7. 핵심 원칙

1. **문서가 없으면 기능도 없다** — 구현 전 반드시 docs/에 설계 문서 작성
2. **Git Safety Protocol** — 커밋/푸쉬/배포 각 단계에서 사용자 승인
3. **Plan Before Code** — 코드 작성 전 설계 방향 브리핑
4. **Fact vs Assumption** — 확인된 사실과 추론을 `[가정]`, `[확인 필요]`로 구분
