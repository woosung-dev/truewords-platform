# ADR-55 — Semantic Cache Hardening (cleanup + invalidation 메타데이터)

- 작성일: 2026-05-02
- 브랜치: `feat/semantic-cache-hardening`
- 영향 범위: `backend/src/cache/`, `backend/scripts/cleanup_semantic_cache.py`,
  `backend/src/chat/{service.py, dependencies.py, pipeline/...}`
- 관련 PR: (TBD)

## 배경

기존 `semantic_cache` 운영에 두 가지 결함:

1. **무한 누적**: Qdrant 가 native point TTL 미지원. `CACHE_TTL_DAYS=7` 은 읽기
   필터일 뿐 디스크 cleanup 없음 → 디스크 비대화 + HNSW latency 증가 + false
   hit 위험 누적.
2. **Invalidation 메커니즘 부재**: corpus(말씀 본문) 갱신 또는 embedding 모델
   변경 시 stale cache 가 자동 무효화되지 않음. 운영자가 수동 truncate 외엔
   대응 수단 없음.

종교 텍스트 RAG 도메인 특성상 **hallucination 영구화 위험**이 시사 RAG 보다
크다 (잘못된 신앙 답변이 캐싱되면 신뢰 직격).

## SaaS 업계 비교 (2026-05-02 조사)

| 회사 | semantic cache 채택 | 대체 전략 |
|---|:-:|---|
| NotebookLM (Google) | ❌ | Long-context (Gemini 2M tokens) 로 chunking 자체 회피 |
| Perplexity | ❌ | Vespa hybrid search, freshness 우선 (시사 RAG) |
| Pinecone Assistant | ❌ | 사용자 직접 구현 (커뮤니티) |
| Anthropic / OpenAI | ❌ | **Prompt caching** (deterministic prefix) |
| Azure OpenAI | ⚠️ 가이드만 | GPTCache + Cosmos DB (LRU+TTL native) |
| GPTCache (Zilliz OSS) | ✓ | LRU/LFU/FIFO/TTL eviction (Redis/Cosmos 의존) |

**결론:** SaaS 빅테크는 semantic cache 를 정면 제품화하지 않음. Production 에서는
anti-pattern 으로 평가받기도 함 (canonical.chat, brain.co, tianpan.co 등). 우리도
인프라 (Qdrant) 가 native TTL 미지원이라 manual cleanup 강제됨.

## 결정 (G2 + β1)

### 채택: 두 가지 hardening 동시 도입
1. **Cleanup 스크립트** (`scripts/cleanup_semantic_cache.py`) — TTL 기반 만료
   point 일괄 삭제. 인프라 무관 (raw httpx, .env 자동 로드).
2. **Invalidation 메타데이터** — payload 에 `corpus_updated_at`,
   `embedding_model` 추가. Qdrant filter 가 mismatch 시 자동 cache miss 처리.

### 보류: Gemini context caching (Step 2)
검토 중 발견: 현재 `DEFAULT_SYSTEM_PROMPT` ≈ 1,500 tokens. Gemini context
caching 의 **최소 토큰 32K** 미달 → cache 객체 자체가 만들어지지 않음.

CORE_TERMS 100~200 용어 큐레이션은 종교 도메인 전문성 필요한 별도 프로젝트로
분리. prompt 가 32K 이상으로 커진 후에야 Step 2 가 의미 있음.

### 보류: 2-Tier (semantic + retrieval) 분리
현재 트래픽 (일 100~1000 질문) 규모에서 over-engineering. 측정 인프라 1주
가동 후 hit rate 가 의미 있게 높으면 검토.

## 구현 요약

### 1. Cleanup 스크립트
- 위치: `backend/scripts/cleanup_semantic_cache.py`
- Qdrant filter 기반 batch delete (scroll 불필요, 단일 REST 호출)
- `--dry-run` / `--execute` 모드, idempotent
- 환경별 trigger 자유 선택 (EC2 cron / k8s CronJob / Docker compose / Cloud
  Scheduler 등) — `docs/guides/semantic-cache-cleanup.md` 참조

### 2. Cache schema 확장 (`backend/src/cache/`)
- `service.py:SemanticCacheService`
  - `check_cache(query_embedding, chatbot_id, corpus_updated_at, ...)` —
    `corpus_updated_at` 인자 추가. 필터 `must` 에 `embedding_model` (항상),
    `corpus_updated_at >= ?` (조건부) 자동 삽입. mismatch 는 Qdrant 가 자동 miss
    처리.
  - `store_cache(..., corpus_updated_at, ...)` — payload 에 두 메타데이터 항상
    저장.
  - structured logging 추가 (`event=cache_hit|cache_miss|cache_store|cache_*_error`)
    → GCP Logging hit-rate 산출.
- `setup.py:ensure_cache_collection` — payload index 4종 (chatbot_id,
  created_at, corpus_updated_at, embedding_model) 누락 시 idempotent 보강.

### 3. corpus_updated_at 추적 (`backend/src/pipeline/`, `backend/src/chat/`)
- `IngestionJobRepository.get_max_completed_at() -> float` — 현재 corpus 의
  `max(IngestionJob.completed_at)` Unix ts 반환. Cache invalidation trigger.
- `ChatService.__init__(ingestion_repo=...)` — 신규 인자.
- `ChatService._run_pre_pipeline` — 매 요청 시작 시 1회 fetch → ctx.corpus_updated_at.
  실패는 silent (graceful) — RAG 본 흐름 영향 없음.
- `CacheCheckStage`, `PersistStage` — `ctx.corpus_updated_at` 인자로 전달.

### 4. ChatContext 확장
- `corpus_updated_at: float = 0.0` 필드 추가.

## 동작 흐름

### Cache hit 정상
```
User → ChatService._run_pre_pipeline
  → ctx.corpus_updated_at = max(IngestionJob.completed_at)
  → CacheCheckStage → check_cache(corpus_updated_at=ctx.corpus_updated_at)
  → Qdrant: must = [
      created_at >= now - 7d,
      embedding_model == "gemini-embedding-001",
      corpus_updated_at >= ctx.corpus_updated_at,
      chatbot_id == ?
    ] + similarity >= 0.88
  → 매칭 시 hit, 아니면 miss
```

### corpus 갱신 후 자동 stale 처리
1. 운영자가 새 말씀 본문 ingest → IngestionJob.completed_at 갱신
2. 다음 사용자 요청 시 ctx.corpus_updated_at 가 새 값 (T2)
3. 기존 cache point 의 corpus_updated_at = T1 < T2 → Qdrant filter 가 자동 제외
4. cache miss → 새 RAG 파이프라인 실행 → 새 cache 저장 (corpus_updated_at = T2)
5. **결과: corpus 갱신 시점부터 자동 cache 무효화. 별도 truncate 불필요.**

### embedding 모델 변경 시 자동 무효화
1. `MODEL_EMBEDDING` 상수 변경 (예: gemini-embedding-001 → 003)
2. SemanticCacheService.embedding_model 도 자동 갱신
3. 기존 cache 의 embedding_model = "gemini-embedding-001" 와 mismatch
4. 모든 cache miss → 자연스럽게 새 모델로 재구축

## 위험 / 한계

| 항목 | 평가 |
|---|---|
| 매 요청 1회 SELECT MAX 부담 | 미미 (IngestionJob 작은 테이블, 인덱스 활용) |
| ingestion_repo 미주입 (테스트 fixture) | graceful — corpus 검증 생략, RAG 정상 |
| cleanup 스크립트 cron 미등록 | 무한 누적 그대로 — 별도 운영 절차로 보강 |
| 단일 threshold (0.88) false positive | 본 ADR 외 별도 측정 후 조정 |
| Hallucination 영구화 (모든 semantic cache 의 본질) | 해결 안 함 — pre-populated FAQ cache 미래 도입 검토 |

## 다음 액션

- [ ] PR 머지 후 운영 cron 등록 (EC2 디플로이 환경에서)
- [ ] 1주일 운영 데이터 수집 후 hit rate 산출 → 의미 있는 hit rate 면 유지,
  < 5% 면 cache 자체 제거 검토 (옵션 F)
- [ ] CORE_TERMS 100~200 용어 큐레이션 (콘텐츠팀 협업) — 완료 시 Step 2 (Gemini
  context caching) 도입 가능
- [ ] Pre-populated FAQ cache (top 100 질문 검수 답) — hallucination 영구화 위험
  근본 해결

## 참고 자료

- canonical.chat — How To Prevent LLM Hallucinations With Semantic Caching
- brain.co — Semantic Caching: Accelerating beyond basic RAG
- tianpan.co — Cache Invalidation for AI: Why Every Cache Layer Gets Harder
- Towards Data Science — Zero-Waste Agentic RAG: Designing Caching Architectures
- Microsoft Tech Community — Optimize Azure OpenAI Applications with Semantic Caching
- Vespa.ai — How Perplexity uses Vespa.ai
- arxiv 2504.09720 — NotebookLM as a Socratic physics tutor
- North Denver Tribune — Google Engineers Avoid Calling NotebookLM "RAG"
