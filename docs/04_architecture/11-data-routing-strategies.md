# 데이터 소스 선택/라우팅 전략 20가지

## 개념

RAG 파이프라인에서 "검색 품질 고도화"와 "데이터 라우팅"은 다른 영역이다.

```
검색 품질 고도화: 찾은 자료의 정확도를 높이는 기술
  → 하이브리드 검색, Re-ranking, Query Expansion 등
  → 참고: 05-rag-pipeline.md

데이터 라우팅: "어디서" "어떤 순서로" "누구에게" 찾을지 제어
  → 이 문서의 20가지 전략
```

---

## 종합 추천 순위표

| 순위 | 전략 | 추천도 | Phase | Qdrant 네이티브 | LLM 비용 |
|------|------|--------|-------|:-:|:-:|
| 1 | Cascading Search | ★★★★★ | 1 | ✅ | $0 |
| 2 | Metadata Pre-Filtering | ★★★★★ | 1 | ✅ | $0 |
| 3 | Semantic Router | ★★★★★ | 1 | ✅ | $0 |
| 4 | Confidence-Based Fallback | ★★★★★ | 1 | ✅ | $0 |
| 5 | Ensemble Retrieval | ★★★★★ | 1 | ✅ | $0 |
| 6 | Time-Based Routing | ★★★★☆ | 1 | ✅ | $0 |
| 7 | Multi-Index Fusion | ★★★★☆ | 1 | ✅ | $0 |
| 8 | Intent-Based Routing | ★★★★☆ | 2 | 부분 | $0~낮음 |
| 9 | Conversation-Aware Routing | ★★★★☆ | 2 | 부분 | 낮음 |
| 10 | Permission-Based Routing | ★★★★☆ | 2 | ✅ | $0 |
| 11 | Adaptive Retrieval | ★★★☆☆ | 2 | 부분 | 낮음 |
| 12 | LLM Router | ★★★☆☆ | 2~3 | ❌ | 중간 |
| 13 | Cost-Based Routing | ★★★☆☆ | 2 | 부분 | $0 |
| 14 | User-Preference Routing | ★★★☆☆ | 2~3 | ✅ | $0 |
| 15 | Hierarchical Routing | ★★★☆☆ | 2 | 부분 | $0 |
| 16 | Query Decomposition | ★★★☆☆ | 3 | ❌ | 높음 |
| 17 | Sparse-to-Dense Progressive | ★★★☆☆ | 2 | ✅ | $0 |
| 18 | A/B Shadow Routing | ★★★☆☆ | 2~3 | 부분 | $0 |
| 19 | Agentic Routing | ★★☆☆☆ | 3 | ❌ | 높음 |
| 20 | Graph-Based Routing | ★★☆☆☆ | 3+ | ❌ | 중간 |

---

## 상세 설명

### 1. Cascading (Waterfall) Search — ★★★★★

A에서 먼저 검색 → 결과 부족하면 B로 폴백.

```
A 검색 → score ≥ 0.75? → YES → 끝
                         NO  → B 검색 → score ≥ 0.65? → YES → 끝
                                                        NO  → C 검색
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | score_threshold + payload 필터로 구현 |
| 구현 난이도 | 낮음 |
| 적용 시점 | Phase 1 |

**우리 프로젝트:** 다중 챗봇 A|B|C 우선순위 검색의 핵심. 자세한 구현은 [07-multi-chatbot-version.md](./07-multi-chatbot-version.md) 참고.

---

### 2. Metadata Pre-Filtering — ★★★★★

검색 전에 메타데이터로 후보를 좁힘.

```python
qdrant.search(
    query_filter={"must": [
        {"key": "book_type", "match": {"any": ["malssum", "mother"]}},
        {"key": "year", "range": {"gte": 2000}}
    ]}
)
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | **네이티브 (최강)** — 중첩 객체, 범위, boolean 조합 |
| 구현 난이도 | 낮음 |
| 적용 시점 | Phase 1 |

**우리 프로젝트:** A|B 챗봇 조합의 기반 기술.

---

### 3. Semantic Router (임베딩 기반 라우팅) — ★★★★★

LLM 호출 없이 임베딩 유사도로 질문을 분류 → 어디서 검색할지 결정.

```python
# 라우트 정의 (예시 질문들)
routes = {
    "말씀_검색": ["축복의 의미는?", "참부모님이 사랑에 대해 뭐라 하셨어?", ...],
    "용어_질문": ["천일국이 뭐야?", "탕감복귀 뜻이?", ...],
    "원리_질문": ["창조원리 설명해줘", "타락론이란?", ...],
}

# 질문 임베딩 → 가장 유사한 라우트로 분류
query_vec = embed("축복이 무슨 뜻이에요?")
route = find_closest_route(query_vec)  # → "용어_질문"

# 라우트에 따라 다른 컬렉션/전략 사용
if route == "용어_질문":
    search_dictionary_first()
elif route == "말씀_검색":
    search_malssum_collection()
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | routing 전용 컬렉션으로 구현 가능 |
| 구현 난이도 | 낮음~중간 |
| 적용 시점 | Phase 1 |
| LLM 비용 | $0 (임베딩만 사용) |

**우리 프로젝트:** 용어 질문 vs 말씀 검색 vs 원리 질문을 자동 분류. `semantic-router` 라이브러리 (Aurelio AI) 활용 가능.

---

### 4. Confidence-Based Fallback — ★★★★★

검색 결과의 신뢰도를 평가 → 낮으면 다른 전략으로 전환.

```
검색 결과 score 확인
    ├── 높음 (≥0.8)  → 그대로 답변
    ├── 중간 (0.5~0.8) → 범위 넓혀서 재검색
    └── 낮음 (<0.5)   → "관련 말씀을 찾지 못했습니다" 정직 답변
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | score 반환 네이티브 |
| 구현 난이도 | 낮음 |
| 적용 시점 | Phase 1 |

**우리 프로젝트:** 종교 텍스트에서 "잘못된 답변보다 답변 안 하는 게 낫다" → 필수 안전장치.

---

### 5. Ensemble Retrieval (다중 방법 결합) — ★★★★★

같은 데이터에 여러 검색 방법을 동시 적용 → 결과 융합.

```
같은 질문으로:
├── Dense 벡터 검색 (의미 유사도)
├── Sparse 벡터 검색 (BM25 키워드)
└── 결과를 RRF로 융합
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | **네이티브 (sparse + dense 하이브리드)** |
| 구현 난이도 | 중간 |
| 적용 시점 | Phase 1 |

**우리 프로젝트:** 하이브리드 검색 자체가 이 전략. [05-rag-pipeline.md](./05-rag-pipeline.md) 참고.

---

### 6. Time-Based / Temporal Routing — ★★★★☆

질문의 시간적 맥락에 따라 최근/과거 데이터를 다르게 가중.

```
"최근 말씀에서 축복에 대해?" → year ≥ 2020 필터
"아버님이 처음 축복하실 때?"  → year 범위 1960-1970
"축복의 의미는?"             → 전체 (시간 필터 없음)
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | **datetime payload 필터 네이티브** |
| 구현 난이도 | 낮음 |
| 적용 시점 | Phase 1 |

**우리 프로젝트:** "최근 말씀 우선 토글" UI와 직접 연결.

---

### 7. Multi-Index Parallel Fusion (Fan-Out) — ★★★★☆

여러 컬렉션에 동시에 검색 → RRF로 병합.

```
사용자 질문
    ├── malssum_collection 검색 (병렬)
    ├── dictionary_collection 검색 (병렬)
    └── wonri_collection 검색 (병렬)
         ↓
    RRF 결합 → Top-10
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | 다중 컬렉션 병렬 쿼리 가능 |
| 구현 난이도 | 중간 |
| 적용 시점 | Phase 1 |

**우리 프로젝트:** 말씀 + 용어사전 + 원리강론 동시 검색 구조에 해당.

---

### 8. Intent-Based Routing — ★★★★☆

질문의 의도를 분류 → 의도별로 다른 검색 전략 적용.

```
의도 분류:
├── "말씀_검색"    → 말씀 컬렉션에서 벡터 검색
├── "용어_정의"    → 용어사전에서 정확 매칭
├── "원리_설명"    → 원리강론에서 계층적 검색
├── "비교_분석"    → 복수 컬렉션 Fan-Out + 비교 프롬프트
└── "일상_인사"    → 검색 없이 직접 응답
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | 검색은 지원, 의도 분류는 앱 레벨 |
| 구현 난이도 | 중간~높음 |
| 적용 시점 | Phase 2 |

**우리 프로젝트:** Semantic Router(3번)의 확장. LlamaIndex의 `RouterQueryEngine` 활용 가능.

---

### 9. Conversation-Aware Routing — ★★★★☆

대화 맥락을 추적 → 후속 질문을 올바른 소스로 라우팅.

```
User: "창조원리에 대해 알려줘"     → 원리강론 컬렉션
User: "그럼 타락론은?"            → 원리강론 컬렉션 (대화 맥락 유지)
User: "아버님이 그것에 대해 뭐라 하셨어?" → 말씀 컬렉션 (주제: 타락론)
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | 앱 레벨에서 세션 상태 관리 |
| 구현 난이도 | 중간~높음 |
| 적용 시점 | Phase 2 |

**우리 프로젝트:** 채팅 로그 + 장기 기억 기능과 연결. 공감형 챗봇에 특히 중요.

---

### 10. Permission-Based Routing — ★★★★☆

사용자 권한에 따라 접근 가능한 데이터 필터링.

```
일반 식구님: 공개 말씀 + 원리강론
목회자:     공개 + 목회자 전용 자료
관리자:     전체 접근
레드팀:     전체 + 테스트 데이터
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | **payload 필터로 네이티브** |
| 구현 난이도 | 낮음~중간 |
| 적용 시점 | Phase 2 |

**우리 프로젝트:** 단계적 공개(Staged Rollout)와 직접 연결. [09-security-countermeasures.md](./09-security-countermeasures.md) 참고.

---

### 11. Adaptive Retrieval (검색 여부 판단) — ★★★☆☆

검색이 필요한 질문인지 먼저 판단.

```
"안녕하세요"         → 검색 불필요, 직접 응답
"감사합니다"         → 검색 불필요
"축복의 의미는?"     → 검색 필요 → RAG 파이프라인
"오늘 날씨 어때?"    → 검색 불필요, 범위 외 안내
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 중간 |
| 적용 시점 | Phase 2 |

**우리 프로젝트:** 불필요한 검색 줄여 비용 절감. 다만 종교 질문은 거의 항상 검색 필요 → 효과 제한적. Self-RAG 논문 (Asai et al., 2023) 참고.

---

### 12. LLM Router — ★★★☆☆

LLM에게 "어디서 검색할지" 판단을 맡김.

```python
prompt = """
질문: "참부모님의 축복 의미"
다음 중 어떤 소스에서 검색해야 합니까?
A: 말씀선집  B: 어머니 말씀  C: 원리강론  D: 대사전
"""
# → LLM: "A, D"
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 중간 |
| 적용 시점 | Phase 2~3 |
| 비용 | 쿼리당 LLM 호출 1회 추가 |

**우리 프로젝트:** Semantic Router(3번)로 대부분 커버 가능 → 우선순위 낮음.

---

### 13. Cost-Based Routing — ★★★☆☆

저렴한 소스부터 시도 → 부족하면 비싼 소스로 에스컬레이션.

```
Tier 1: Semantic Cache ($0)          → 히트? → 끝
Tier 2: Qdrant 검색 (~$0.001)       → 충분? → 끝
Tier 3: LLM Query Expansion (~$0.01) → 확장 검색
Tier 4: Agentic RAG (~$0.05)        → 다단계 추론
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 낮음~중간 |
| 적용 시점 | Phase 2 |

**우리 프로젝트:** Semantic Cache → Qdrant → Query Expansion 순서가 자연스러운 비용 최적화 경로.

---

### 14. User-Preference Routing — ★★★☆☆

사용자 프로필/설정에 따라 검색 소스 조정.

```
사용자 설정:
├── 선호 자료: 말씀선집 중심
├── 깊이: 초급 (쉬운 설명)
└── 최근 말씀 우선: ON
    ↓
검색 시 자동 적용:
  filter: {book_type: "malssum", year: {gte: 2015}}
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | payload 필터 |
| 구현 난이도 | 낮음 |
| 적용 시점 | Phase 2~3 |

**우리 프로젝트:** 개인 맥락 반영 기능과 연결. "개인화 챗봇" 버전에 적합.

---

### 15. Hierarchical / Taxonomy Routing — ★★★☆☆

분류 체계를 따라 단계적으로 검색 범위를 좁힘.

```
말씀 → 말씀선집 → 제45권 → 제3장 → 축복 관련 절
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 중간~높음 |
| 적용 시점 | Phase 2 |

**우리 프로젝트:** 계층적 청킹 + 메타데이터 필터링으로 유사하게 구현 가능.

---

### 16. Query Decomposition Routing — ★★★☆☆

복잡한 질문을 분해 → 각 하위 질문을 다른 소스에서 검색.

```
"창조원리와 복귀원리의 관계는?"
    ↓ LLM 분해
Sub-Q1: "창조원리란?" → 원리강론 컬렉션
Sub-Q2: "복귀원리란?" → 원리강론 컬렉션
Sub-Q3: "두 원리의 관계" → 말씀 컬렉션
    ↓
결과 종합 → 답변
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 높음 |
| 적용 시점 | Phase 3 |

**우리 프로젝트:** Agentic RAG의 일부. LlamaIndex의 `SubQuestionQueryEngine` 활용 가능.

---

### 17. Sparse-to-Dense Progressive Routing — ★★★☆☆

1차로 키워드 검색(빠름) → 결과를 기반으로 2차 벡터 검색(정확).

```
1차: BM25로 "참부모" 키워드 매칭 → 후보 100개
    ↓
후보 내에서 dense 벡터 검색 → Top-10
```

| 항목 | 내용 |
|------|------|
| Qdrant 지원 | sparse + dense 모두 지원 |
| 구현 난이도 | 중간 |
| 적용 시점 | Phase 2 |

---

### 18. A/B Test / Shadow Routing — ★★★☆☆

트래픽 일부를 새로운 검색 전략으로 보내서 실험.

```
90% → 기존 전략 (결과 반환)
10% → 새 전략 (결과 반환 + 비교 로그)

또는 Shadow:
100% → 기존 전략 (결과 반환)
100% → 새 전략 (로그만, 사용자에게 안 보임)
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 중간 |
| 적용 시점 | Phase 2~3 |

**우리 프로젝트:** 레드팀 테스트 시 유용. 새 임베딩 모델이나 청킹 전략 비교.

---

### 19. Agentic Routing (ReAct 패턴) — ★★☆☆☆

LLM 에이전트가 자율적으로 어떤 도구를 호출할지 판단.

```
Agent: "축복에 대한 질문이네. 먼저 용어사전을 확인하자"
    → search_dictionary("축복")
Agent: "정의를 알았으니, 관련 말씀을 찾자"
    → search_malssum("축복의 의미", filter={book_type: "malssum"})
Agent: "결과가 충분하다. 답변을 생성하자"
    → generate_answer(context)
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 높음 |
| 적용 시점 | Phase 3 |
| 비용 | 높음 (LLM 다회 호출) |

---

### 20. Graph-Based Routing — ★★☆☆☆

지식 그래프의 관계를 따라 검색 소스를 결정.

```
질문에서 "축복" 엔티티 추출
    → 지식 그래프 탐색
    → 축복 ↔ 혈통전환 ↔ 타락론 ↔ 복귀원리
    → 관련 컬렉션 모두 검색
```

| 항목 | 내용 |
|------|------|
| 구현 난이도 | 매우 높음 |
| 적용 시점 | Phase 3+ |

**우리 프로젝트:** 장기적으로 매력적. 종교 용어 간 관계가 풍부하므로 Knowledge Graph 구축 시 강력.

---

## Phase별 적용 계획

### Phase 1 (출시) — LLM 추가 비용 $0

```
사용자 질문
    ↓
[Semantic Router] 질문 유형 분류 (용어/말씀/원리)        ← 전략 3
    ↓
[Metadata Pre-Filtering] 챗봇 버전 A|B 필터              ← 전략 2
    ↓
[Time-Based Routing] 최근 말씀 우선 토글 반영             ← 전략 6
    ↓
[Ensemble Retrieval] 하이브리드 검색 (sparse + dense)     ← 전략 5
    ↓
[Cascading Search] A 우선 → B 폴백                       ← 전략 1
    ↓
[Multi-Index Fusion] 말씀 + 용어사전 + 원리강론 병합      ← 전략 7
    ↓
[Confidence-Based Fallback] score 낮으면 범위 확대/정직 답변 ← 전략 4
```

Phase 1에서 **7가지 전략을 LLM 추가 비용 없이** 구현 가능.

### Phase 2 (고도화) — 개인화 + 맥락

- Intent-Based Routing (전략 8) — 더 정교한 분류
- Conversation-Aware Routing (전략 9) — 대화 맥락 추적
- Permission-Based Routing (전략 10) — 단계적 공개
- Adaptive Retrieval (전략 11) — 불필요한 검색 스킵
- Cost-Based Routing (전략 13) — Semantic Cache 연동
- User-Preference Routing (전략 14) — 개인화

### Phase 3 (장기) — AI 에이전트

- Query Decomposition (전략 16)
- Agentic Routing (전략 19)
- Graph-Based Routing (전략 20)
