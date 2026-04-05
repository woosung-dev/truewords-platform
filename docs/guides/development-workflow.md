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
| PostgreSQL 8테이블 + Async 전환 | `590e36e` | Done |
| Router/Service/Repository 패턴 적용 | `590e36e` | Done |
| 관리자 JWT 인증 + CRUD API | `590e36e` | Done |
| common/gemini.py 중앙 집중 클라이언트 | `590e36e` | Done |
| Alembic 마이그레이션 설정 | `590e36e` | Done |
| 테스트 async 전환 (48 passed) | `4c6c157` | Done |
| Docker Compose PostgreSQL 추가 | `590e36e` | Done |
| Seed/Admin 초기화 스크립트 | `590e36e` | Done |

### 완료 (Phase 3 + 인프라, 2026-04-04 기준)

| 항목 | 커밋 | 상태 |
|------|------|------|
| 관리자 대시보드 (Next.js) | `bcc4e1b` | Done |
| Phase 3 보안 가드레일 (Prompt Injection, Rate Limiting, 면책 고지) | `4f2b848` | Done |
| SSE 스트리밍 응답 (POST /chat/stream) | `4f2b848` | Done |
| Semantic Cache (Qdrant, 유사도 0.93, TTL 7일) | `4f2b848` | Done |
| 배포 인프라 (Dockerfile, CI/CD, Vercel) | `3fd75d7` | Done |
| 임베딩 중복 계산 최적화 | `ea75d62` | Done |
| Alembic 초기 마이그레이션 | `3fd75d7` | Done |
| 테스트 190개 (백엔드) + 25 (Vitest) + 12 (E2E) | - | Done |
| GCP/Vercel 실제 인프라 배포 완료 | - | Done |

### 미완료 (우선순위 순)

| 우선순위 | 항목 | 설계 문서 | 비고 |
|----------|------|-----------|------|
| **P0** | 레드팀 테스트 | `docs/04_architecture/09-security-countermeasures.md` | 배포 후 내부 팀 테스트 |
| **P1** | 검색 에러 핸들링 | - | Qdrant/Gemini 실패 시 사용자 친화적 에러 |
| **P1** | Query Expansion/Rewriting | `docs/04_architecture/05-rag-pipeline.md` | LLM으로 질문 확장/재작성 |
| **P2** | Flutter 모바일 앱 | `docs/01_requirements/16-app-feature-spec.md` | 레드팀 후 Phase 4 |
| **P2** | 사용자 인증 (Clerk) | - | Flutter와 함께 |
| **보류** | 종교 용어 사전 동적 주입 | `docs/02_domain/06-terminology-dictionary-structure.md` | 데이터 미확보 |
| **P3** | Context Caching (Gemini) | `docs/04_architecture/04-gemini-file-search-analysis.md` | 대용량 정적 콘텐츠 캐싱 |

### 다음 작업 추천 순서

```
1. 레드팀 테스트
   - 악의적 질문 테스트, 답변 품질 평가
   - 보안 가드레일 검증

2. 검색 에러 핸들링
   - 외부 서비스 장애 시 500 → 사용자 친화적 메시지

3. Flutter 모바일 앱 (레드팀 후)
   - MVP 3개 화면: 채팅(SSE), 챗봇 선택, 설정
```

---

## 7. 핵심 원칙

1. **문서가 없으면 기능도 없다** — 구현 전 반드시 docs/에 설계 문서 작성
2. **Git Safety Protocol** — 커밋/푸쉬/배포 각 단계에서 사용자 승인
3. **Plan Before Code** — 코드 작성 전 설계 방향 브리핑
4. **Fact vs Assumption** — 확인된 사실과 추론을 `[가정]`, `[확인 필요]`로 구분
