# Phase 1 RAG PoC 설계 스펙 (회고적 문서)

> **문서 유형:** 회고적 설계 스펙 (Phase 1 구현 완료 후 작성)
> **작성일:** 2026-03-28
> **상태:** Phase 1 완료

---

## 1. 목표와 성공 기준

### 목표

가정연합 말씀 텍스트(샘플 1권)로 하이브리드 RAG 파이프라인을 구축하고, `/chat` API에서 **질문 → 검색 → 생성 → 출처 포함 답변**이 동작함을 검증한다.

### 달성된 성공 기준

| 기준                                  | 결과 | 비고                                             |
| ------------------------------------- | ---- | ------------------------------------------------ |
| 텍스트 적재 파이프라인 동작           | 달성 | 축복행정 규정집 206 청크 적재                    |
| 하이브리드 검색 (dense + sparse) 동작 | 달성 | RRF fusion, top_k=10                             |
| LLM 기반 답변 생성 + 출처 표시        | 달성 | Gemini 2.5 Flash, 상위 3개 출처 반환             |
| POST /chat API 정상 응답              | 달성 | JSON: `{answer, sources[{volume, text, score}]}` |
| 24개 pytest 전체 통과                 | 달성 | 모든 모듈 단위 테스트 + API 통합 테스트          |
| 환각 억제 동작 확인                   | 달성 | evaluate.py 5개 질문 테스트                      |
| Rate limit 대응                       | 달성 | 429 재시도 메커니즘 구현                         |

---

## 2. 설계 결정 + 트레이드오프

### 2.1 임베딩 모델: Gemini embedding-001 (3072 dims)

**선택 근거:**

- Gemini 생태계 통합: 생성 모델(Gemini 2.5 Flash)과 동일 플랫폼 → API 키 1개로 관리
- 3072 차원: 고차원으로 종교 텍스트의 미묘한 의미 차이를 포착
- task_type 구분: `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`로 비대칭 임베딩 지원
- 무료 티어 활용 가능: PoC 단계에서 비용 0

**트레이드오프:**

- 3072 dims는 768 dims 대비 저장/검색 비용 4배 → PoC에서는 문제없으나 615권 적재 시 고려 필요
- Gemini API 의존: 오프라인 임베딩 불가, rate limit(분당 1500) 제약
- 한국어 종교 텍스트 특화 평가 부재 → 실제 검색 품질은 경험적 확인에 의존

**계획 대비 변경:** 계획 문서에서는 `text-embedding-004` (768 dims) + `google-generativeai` SDK를 명시했으나, 구현에서는 `gemini-embedding-001` (3072 dims) + `google-genai` (신규 SDK)로 변경됨. 더 높은 임베딩 품질과 최신 SDK 사용이라는 개선.

### 2.2 벡터DB: Qdrant (Docker, latest)

**선택 근거:**

- Named vectors 지원: 동일 컬렉션에 `dense` (3072 dims) + `sparse` (BM25) 벡터 공존
- Prefetch + Fusion API: 서버 사이드 RRF fusion을 네이티브로 지원 → 클라이언트 로직 최소화
- Docker 배포 간편: `docker-compose.yml` 4줄로 실행 가능
- Python SDK 성숙도 높음 (`qdrant-client[fastembed]`)

**트레이드오프:**

- 로컬 Docker 전용: 프로덕션 배포 시 Qdrant Cloud 또는 자체 호스팅 필요
- `:latest` 태그 사용: 재현성 약화 (계획에서는 `v1.12.0` 명시)
- 단일 노드: 수평 확장 미고려

### 2.3 검색: RRF Fusion 하이브리드 (dense + BM25 sparse)

**선택 근거:**

- 종교 텍스트의 고유 용어 ("참부모님", "천일국", "효정") → BM25 키워드 매칭이 벡터보다 정확
- 추상적 질문 ("사랑의 의미") → 벡터 검색이 강함
- RRF (Reciprocal Rank Fusion): 양쪽 결과를 순위 기반으로 결합, 가중치 튜닝 불필요

**구현 상세:**

- Prefetch: dense 50개, sparse 50개 후보
- Fusion: `Fusion.RRF` (Qdrant 네이티브)
- 최종 반환: top_k=10 (검색), 상위 3개만 응답에 포함

**트레이드오프:**

- BM25 sparse 모델: fastembed의 `Qdrant/bm25` 사용 → 한국어 토크나이저 품질 미검증
- Re-ranker 미적용: cross-encoder 2차 필터링 없이 RRF 결과를 바로 사용
- prefetch 50개는 206 청크 기준으로 과도할 수 있으나, 615권 확장 시 적절

### 2.4 생성: Gemini 2.5 Flash + 시스템 프롬프트

**선택 근거:**

- Gemini 2.5 Flash: 빠른 응답 속도, 낮은 비용, 한국어 지원
- 시스템 프롬프트 구성:
  - **핵심 용어 7개**: 참부모님, 말씀, 원리강론, 천일국, 훈독회, 참사랑, 하늘 부모님
  - **답변 규칙 5개**: 출처 근거 필수, 추론 금지, 미발견 시 명시, 출처 표기, 한국어 답변

**트레이드오프:**

- 비스트리밍 응답: 전체 생성 완료 후 반환 → UX 체감 지연 (Phase 2에서 SSE 스트리밍 도입 예정)
- temperature/top_p 미설정: Gemini 기본값 사용 → 답변 일관성 제어 미흡
- 계획에서는 핵심 용어 20개를 명시했으나, 실제 구현은 7개로 축소

### 2.5 청킹: 단락 기반 (빈 줄 분리 + 인접 오버랩)

**선택 근거:**

- 한국어 텍스트의 자연스러운 문단 구분: `\n\n` (빈 줄)
- 문단 병합: max_chars=500자까지 인접 문단을 버퍼에 누적
- 오버랩: 50자 (이전 청크의 마지막 50자를 다음 청크 시작에 포함) → 문맥 연결 유지

**트레이드오프:**

- 고정 문자 수 기반: 토큰 기반이 아니므로 LLM 컨텍스트 윈도우와 정확히 매핑되지 않음
- 계층적 청킹 미구현: 권 > 장 > 절 메타데이터 없이 flat 구조
- 한국어 500자는 영어 대비 정보 밀도가 높아 적절한 크기

### 2.6 Rate Limit 대응

**구현:**

- `_EMBED_DELAY_SEC = 0.2` (초당 5 요청, Gemini 무료 티어 분당 1500 기준 안전 마진)
- 429 에러 시: 60초 대기 후 재시도, 최대 3회
- 배치 처리: 10개 청크마다 중간 upsert → 대량 적재 시 진행 상황 확인 + 실패 시 부분 복구

**트레이드오프:**

- 동기식 처리: 비동기 병렬 임베딩 미적용 → 206 청크 기준 약 41초 소요
- 60초 고정 대기: 지수 백오프(exponential backoff) 대신 고정 대기 → 비효율적일 수 있음

---

## 3. 범위 제한 (NOT in scope)

Phase 1에서 **의도적으로 제외**한 항목:

| 항목                             | 이유                               | 해결 Phase |
| -------------------------------- | ---------------------------------- | ---------- |
| 인증/인가                        | PoC 단계에서 불필요                | Phase 2    |
| 프론트엔드 UI                    | 백엔드 RAG 파이프라인 검증이 목적  | Phase 2    |
| SSE 스트리밍                     | 비스트리밍으로 기능 검증 우선      | Phase 2    |
| 프로덕션 배포                    | 로컬 Docker로 충분                 | Phase 4    |
| 시맨틱 캐시                      | 반복 질문 최적화는 트래픽 발생 후  | Phase 3    |
| 대화 히스토리                    | 단일 턴 Q&A로 PoC 검증             | Phase 2    |
| Re-ranker                        | RRF만으로 PoC 품질 충분            | Phase 3    |
| Query Expansion                  | 사용자 질문 확장은 고도화 단계     | Phase 3    |
| 다중 컬렉션 (용어사전, 원리강론) | 단일 컬렉션으로 PoC 검증           | Phase 3    |
| 615권 전체 적재                  | 1권 샘플로 파이프라인 검증         | Phase 3    |
| 로깅/모니터링                    | PoC에서 print 문으로 대체          | Phase 4    |
| CI/CD                            | 로컬 개발 환경 전용                | Phase 4    |
| Prompt Injection 방어            | 시스템 프롬프트 규칙으로 최소 방어 | Phase 2    |

---

## 4. 의존성 맵

### 외부 서비스

```
┌─────────────────────────────┐
│       TrueWords Backend     │
│       (FastAPI 0.115)       │
│                             │
│  ┌─────────┐  ┌──────────┐ │
│  │ Pipeline │  │  Search  │ │
│  │ (ingest) │  │ (hybrid) │ │
│  └────┬─────┘  └────┬─────┘ │
│       │              │       │
│  ┌────▼──────────────▼────┐ │
│  │     Embedder           │ │
│  │  (dense + sparse)      │ │
│  └────┬───────────┬───────┘ │
│       │           │         │
└───────┼───────────┼─────────┘
        │           │
  ┌─────▼─────┐ ┌──▼──────────┐
  │ Gemini API│ │ fastembed   │
  │ (Google)  │ │ (로컬 BM25) │
  └───────────┘ └─────────────┘
        │
  ┌─────▼─────┐
  │ Qdrant    │
  │ (Docker)  │
  │ port 6333 │
  └───────────┘
```

### 의존성 상세

| 서비스     | 용도                                      | 버전                     | 비고                         |
| ---------- | ----------------------------------------- | ------------------------ | ---------------------------- |
| Gemini API | 임베딩 (embedding-001) + 생성 (2.5-flash) | google-genai 1.68.0      | API 키 필요, rate limit 존재 |
| Qdrant     | 벡터 저장 + 하이브리드 검색               | Docker latest            | 로컬 6333 포트, 영속 볼륨    |
| fastembed  | BM25 sparse 임베딩                        | qdrant-client[fastembed] | 로컬 실행, 네트워크 불필요   |

### Python 의존성

```
fastapi >= 0.115.0
uvicorn[standard] >= 0.32.0
qdrant-client[fastembed] >= 1.12.0
google-genai >= 0.8.0
pydantic-settings >= 2.6.0
httpx >= 0.27.0
```

---

## 5. 알려진 한계와 개선 방향

### 즉시 개선 가능 (Low Effort)

| 한계                            | 영향                        | 개선 방향                   | Phase   |
| ------------------------------- | --------------------------- | --------------------------- | ------- |
| temperature 미설정              | 답변 일관성 불안정          | `temperature=0.3` 명시      | Phase 2 |
| API 키 환경변수만으로 보호      | 보안 취약                   | SecretStr + 인증 미들웨어   | Phase 2 |
| 에러 응답 미표준화              | 클라이언트 에러 처리 어려움 | HTTPException + 에러 스키마 | Phase 2 |
| health 엔드포인트 Qdrant 미확인 | 실제 서비스 상태 반영 안 됨 | Qdrant 연결 확인 추가       | Phase 2 |

### 중기 개선 (Medium Effort)

| 한계                    | 영향             | 개선 방향                   | Phase   |
| ----------------------- | ---------------- | --------------------------- | ------- |
| 비스트리밍 응답         | UX 지연 체감     | SSE 스트리밍                | Phase 2 |
| 대화 히스토리 없음      | 문맥 이해 불가   | 세션 기반 멀티턴            | Phase 2 |
| BM25 한국어 품질 미검증 | 검색 정확도 영향 | 한국어 토크나이저 비교 평가 | Phase 3 |
| 계층적 청킹 미구현      | 문맥 손실        | 권 > 장 > 절 메타데이터     | Phase 3 |
| Re-ranker 부재          | 검색 정밀도 한계 | cross-encoder 2차 필터링    | Phase 3 |

### 장기 개선 (High Effort)

| 한계                 | 영향                | 개선 방향                 | Phase    |
| -------------------- | ------------------- | ------------------------- | -------- |
| 615권 미적재         | 전체 말씀 검색 불가 | 대용량 데이터 파이프라인  | Phase 3  |
| 프로덕션 배포 미구현 | 외부 접근 불가      | Cloud 배포 (Fly.io / GCP) | Phase 4  |
| 모니터링 없음        | 장애 감지 불가      | 로깅 + 메트릭 + 알림      | Phase 4  |
| Agentic RAG 미구현   | 복합 질문 대응 불가 | 다단계 검색-추론 에이전트 | Phase 3+ |

---

## 6. 품질 평가 결과

### evaluate.py 테스트 (5개 질문)

`scripts/evaluate.py`로 실행한 E2E 평가:

| #   | 질문                               | 평가 목적             |
| --- | ---------------------------------- | --------------------- |
| 1   | 축복행정이란 무엇인가?             | 핵심 개념 정의 검색   |
| 2   | 국제결혼을 위한 조건은 무엇인가?   | 구체적 조건/규정 검색 |
| 3   | 축복식 절차는 어떻게 되는가?       | 순서/프로세스 검색    |
| 4   | 참부모님의 축복에 대한 내용은?     | 종교 용어 포함 검색   |
| 5   | 축복가정의 의무와 책임은 무엇인가? | 의무/책임 규정 검색   |

### 확인된 동작

- **출처 표시**: 모든 답변에 `축복행정 규정집` 출처가 포함됨
- **환각 억제**: 시스템 프롬프트의 "제공된 말씀 문단만을 근거로 답변" 규칙이 동작
- **미발견 처리**: 적재된 데이터에 없는 질문 시 "해당 내용을 말씀에서 찾지 못했습니다" 응답 확인
- **하이브리드 검색 효과**: "축복행정"(키워드) + "의무와 책임"(의미) 모두에서 관련 청크 검색 성공

### 한계

- 자동화된 품질 메트릭 없음 (ROUGE, BLEU, faithfulness score 등)
- 5개 질문은 최소 검증 수준 → 대규모 평가 세트 필요
- 단일 권 기준이므로 다권 간 교차 검색 품질 미확인

---

## 7. 아키텍처 요약

### 모듈 구조

```
backend/
├── main.py                    # FastAPI 앱 진입점
├── api/
│   └── routes.py              # POST /chat (요청 → 검색 → 생성 → 응답)
├── src/
│   ├── config.py              # pydantic-settings 환경변수
│   ├── qdrant_client.py       # Qdrant 연결 + 컬렉션 생성
│   ├── pipeline/
│   │   ├── chunker.py         # 텍스트 → Chunk 리스트
│   │   ├── embedder.py        # dense(Gemini) + sparse(BM25)
│   │   └── ingestor.py        # Chunk → Qdrant upsert (rate limit 대응)
│   ├── search/
│   │   └── hybrid.py          # RRF 하이브리드 검색
│   └── chat/
│       ├── prompt.py          # 시스템 프롬프트 + 컨텍스트 조립
│       └── generator.py       # Gemini 2.5 Flash 생성
├── scripts/
│   ├── ingest.py              # 데이터 적재 스크립트
│   └── evaluate.py            # E2E 품질 평가 스크립트
└── tests/                     # 24개 단위/통합 테스트
```

### 데이터 흐름

```
[적재 경로]
txt 파일 → chunk_text() → embed_dense_document() + embed_sparse()
  → PointStruct (dense + sparse vectors + payload) → Qdrant upsert

[질의 경로]
POST /chat {query} → embed_dense_query() + embed_sparse()
  → Qdrant prefetch (dense 50 + sparse 50) → RRF fusion → top 10
  → build_context_prompt() → Gemini 2.5 Flash generate
  → ChatResponse {answer, sources[top 3]}
```
