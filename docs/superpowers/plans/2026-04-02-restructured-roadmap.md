# TrueWords Platform — 재조정된 Phase 로드맵

> **재조정일:** 2026-04-02
> **이유:** 레드팀 테스트를 식구용 UI 개발보다 우선하여, 검색 품질 검증 후 UI 개발 진행

---

## Phase 순서 변경 요약

```
[기존]                              [재조정]
Phase 1: RAG PoC ✅                  Phase 1: RAG PoC ✅ (동일)
Phase 2: Flutter UI                  Phase 2: 데이터 파이프라인 + 검색 고도화
Phase 3: 데이터 파이프라인             Phase 3: 배포 + 보안 + 관리자 페이지 + 레드팀
Phase 4: 프로덕션 인프라               Phase 4: 식구용 Flutter UI + 단계적 공개
```

---

## Phase 1: RAG PoC — ✅ 완료

샘플 데이터로 질문 → 하이브리드 검색 → Gemini 답변 생성 → 출처 포함 응답 파이프라인 동작 확인.

**산출물:** `backend/` (FastAPI + Qdrant + Gemini 2.5 Flash)

---

## Phase 2: 데이터 파이프라인 + 검색 고도화

**목표:** 615권 전체 적재 + A/B/C 소스 구분 + Cascading Search + Re-ranking으로 레드팀 테스트 가능 수준의 검색 품질 확보

### Phase 2A: 데이터 파이프라인 스케일

> **상세 계획:** `docs/superpowers/plans/2026-03-28-phase3-data-pipeline.md` (기존 Phase 3 문서)

- 문장 경계 청킹 (kss)
- 메타데이터 추출 (권번호, 제목, 날짜)
- HWP→TXT 변환
- 증분 적재 + 진행 추적
- 배치 통계 리포트
- 시맨틱 캐시

### Phase 2B: 검색 고도화

> **상세 계획:** `docs/superpowers/plans/2026-04-02-phase2b-search-enhancement.md`

- Chunk/Payload에 `source` 필드 추가 (A/B/C 데이터 분류)
- hybrid_search 필터 지원 (source, book_type)
- Cascading Search (A 우선 → B 폴백 → C 폴백)
- Confidence-Based Fallback (score 임계값 기반)
- Re-ranking (Cross-encoder 정밀 재순위)
- 챗봇별 검색 설정 모듈
- `/chat` endpoint chatbot_id 지원

---

## Phase 3: 프로덕션 배포 + 보안 + 관리자 페이지 + 레드팀

**목표:** 스테이징 환경에 배포하고, 관리자가 챗봇 설정을 조정하면서 레드팀이 다방면으로 테스트

### 배포 + 인프라

> **기반 계획:** `docs/superpowers/plans/2026-03-28-phase4-production-infra.md` (기존 Phase 4 문서)

- GCP Cloud Run 배포
- CI/CD (GitHub Actions: pytest + ruff)
- structlog 구조화 로깅

### 보안 가드레일

> **설계 참조:** `docs/04_architecture/09-security-countermeasures.md`

- API Key 인증 + Rate Limiting
- Prompt Injection 방어 (패턴 DB)
- 답변 범위 제한 (인용 중심, 해석 금지)
- 답변 워터마킹 (AI 생성 고지)
- 민감 인명/내용 필터
- 악의적 질문 패턴 DB 축적

### 관리자 페이지

- 챗봇 버전 관리 (A|B, A|B|C 조합 생성/수정)
- 검색 우선순위 설정 (Cascading 순서, 임계값 조정)
- 질문/답변 로그 열람
- 악의적 질문 패턴 관리
- 시스템 프롬프트 편집 (용어 정의)

### 레드팀 테스트

- 내부 팀이 스테이징 URL에서 다방면 검색 테스트
- 악의적 질문, 범위 이탈, Prompt Injection 시도
- 로그 분석 → 가드레일 강화
- 검색 품질 피드백 → Phase 2 파라미터 튜닝

---

## Phase 4: 식구용 Flutter UI + 단계적 공개

**목표:** 레드팀 검증 완료된 검색 품질 위에 식구용 앱 구축

### Flutter 채팅 앱

> **기반 계획:** `docs/superpowers/plans/2026-03-28-phase2-web-chat-ui.md` (기존 Phase 2 문서)

- Flutter + Riverpod + go_router
- SSE 스트리밍 (`POST /chat/stream`)
- 메시지 버블, 출처 카드, 스트리밍 표시

### 고도화 (선택)

- 대화 맥락 추적 (Conversation-Aware Routing)
- 사용자 선호 설정 (User-Preference Routing)
- Query Expansion (질문 확장)
- Semantic Router (질문 유형 자동 분류)

### 단계적 공개

```
Step 1: 인증된 식구님 대상 제한 공개
Step 2: 피드백 수집 + 개선
Step 3: 전체 공개
```

---

## 참조 문서 매핑

| 재조정 Phase | 상세 계획 문서 | 설계 참조 |
|-------------|--------------|----------|
| Phase 2A | `plans/2026-03-28-phase3-data-pipeline.md` | `specs/2026-03-28-phase3-data-pipeline-design.md` |
| Phase 2B | `plans/2026-04-02-phase2b-search-enhancement.md` | `04_architecture/07-multi-chatbot-version.md`, `11-data-routing-strategies.md` |
| Phase 3 | `plans/2026-03-28-phase4-production-infra.md` + 신규 | `04_architecture/09-security-countermeasures.md` |
| Phase 4 | `plans/2026-03-28-phase2-web-chat-ui.md` | `specs/2026-03-28-phase2-web-chat-ui-design.md` |
