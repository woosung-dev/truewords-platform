# 멀티턴 대화 메모리 설계

> 작성: 2026-07-08. 업계 조사(병렬 리서치 2건) + 파이프라인 탐사 기반.
> 승인된 방안: **B — 이력 주입(Phase 1) + condense 검색 재작성(Phase 2)**.

---

## 1. 문제

세션 개념(session_id 왕복, `SessionMessage` DB 저장)은 있으나 **대화 이력이 프롬프트·검색 어디에도 반영되지 않는다.** 후속 질문("그럼 그건 어떻게 실천하나요?")의 대명사·생략을 AI가 해소하지 못해 턴 2부터 검색·답변이 모두 어긋난다.

## 2. 업계 표준 (조사 결론)

**"검색은 재작성 질문으로, 생성은 원본 이력으로" 이원 구조** — LlamaIndex `CondensePlusContext`(기본 chat_mode), LangChain `create_history_aware_retriever` 공통 사상.

| 원칙 | 근거 |
|------|------|
| 후속 질문은 standalone question 으로 재작성(condense) 후 검색 | 후속 메시지 60%+ 가 미해결 대명사/생략 포함 (Alhena 프로덕션 통계) |
| 첫 턴은 condense 스킵, 실패 시 원문 fallback, "이미 독립적이면 그대로" 규칙 | LangChain #8818 (무관 질문 오염), ZenML (과잉 재작성 취약성) |
| 생성 프롬프트에는 원본 이력 주입, 최근 4~6턴 + 토큰 상한 | ORConvQA w=6 성능 피크 (SIGIR 2020), Pinecone k=6 |
| 후속 턴은 시맨틱 캐시 조회·저장 스킵 | ContextCache/MeanCache — 질문 단독 임베딩 캐시의 문맥 의존 오답 히트 정량 근거 |
| 요약 메모리·agentic RAG 는 장기 세션/고급 단계용 | 시연 PoC 에는 과함 (YAGNI) |

주요 출처: LlamaIndex condense_plus_context 문서, LangChain RAG docs, arXiv 2005.11364 (ORConvQA), arXiv 2506.22791 (ContextCache), alhena.ai query-rewriting 블로그.

## 3. 검토한 방안

| 방안 | 내용 | 추천도 | 결정 |
|---|---|:---:|---|
| A. 이력 주입만 | 최근 N턴 프롬프트 주입 + 후속 턴 캐시 스킵 | ★★★★☆ | Phase 1 로 흡수 |
| **B. A + condense** | 표준 이원 구조 완성 | ★★★★★ | **채택** |
| C. condensed-query 캐싱 + follow-up 분류기 | 후속 턴 캐시 히트율 회복 | ★★★☆☆ | 백로그 (B 운영 데이터 후) |
| D. 요약 메모리 / agentic RAG | rolling summary, retrieval-as-tool | ★★☆☆☆ | 보류 |

## 4. 설계 (방안 B)

### Phase 1 — 이력 주입 + 캐시 게이트

```
SessionStage: 기존 세션 재사용 시, 현재 user 메시지 create_message "이전"에
              get_recent_messages(limit=12) 로 ctx.history 로드
              → bool(ctx.history) == "후속 턴" 판정의 단일 기준
CacheCheckStage: ctx.history 있으면 조회 스킵
PersistStage:    ctx.history 있으면 store_cache 스킵
Generation(동기/스트림): select_history_window(ctx.history) 를
              build_context_prompt(..., history=...) 로 주입
```

- `chat/history.py` (신규): `estimate_tokens(text)` = len//2+1 (한국어 Gemini 근사),
  `select_history_window(messages, *, token_budget=1200, max_messages=12, assistant_truncate_chars=400)`.
  최신→과거 역순 누적, assistant 는 400자 truncate, 예산/개수 초과 시 중단, 반환은 오래된→최신 (role, content) 쌍.
- `token_count` 기록 시작 (user: SessionStage, assistant: PersistStage + mini-persist). 기존 NULL 행은 즉석 추정 fallback — 마이그레이션 불필요.
- 프롬프트: history=None 이면 **기존 출력과 바이트 동일** (274+ 테스트 무회귀 보증).

### Phase 2 — condense 검색 재작성

- `search/query_rewriter.py`: `condense_query(query, history, *, term_rewrite)` — 후속 턴에서 문맥 해소 + (봇 설정 시) 종교 용어 변환을 **LLM 1회 결합 호출**. 타임아웃 2.5s, 실패/빈응답 → 원문 fallback.
- `QueryRewriteStage`: `if ctx.history:` condense 분기 (윈도우 token_budget=800). condense 게이트는 `query_rewrite_enabled` 토글과 **독립** — `DEFAULT_RUNTIME_CONFIG` 가 rewrite_enabled=False 라 종속시키면 기본 봇에서 멀티턴 검색이 죽는 함정 회피.
- `IntentClassifierStage`: meta 판정 + 후속 턴이면 short-circuit 하지 않고 기본 intent 로 강등 + 로그 — 원 질문 단독으론 "그게 뭐예요?" 를 meta 로 오분류해 삼키는 문제 방지.
- 생성은 계속 **원본 질문 + 원본 이력** (condensed 는 검색 전용). 위기 키워드 감지도 현재 질문 기준 유지.

### 불변 조건

- FSM(state.py)·DB 스키마·프론트·캐시 payload(`sources_for_cache`) 변경 없음.
- `original_query_embedding` 불변 (캐시 일관성).
- 이력의 user 발화는 각 턴에서 InputValidation 통과분, assistant 발화는 SafetyOutput 통과분만 저장되어 재주입 안전.

## 5. 관찰성 / 후속 판단 데이터

- `SearchEvent.rewritten_query` 에 condensed 질문이 기존 경로로 기록됨 → 재작성 품질 사후 감사.
- 캐시 스킵으로 인한 히트율 변화는 운영 로그로 관찰, 방안 C(condensed-query 캐싱) 착수 여부 판단.

## 6. 백로그

- [ ] 방안 C — condensed-query 임베딩 기준 캐시 조회/저장 (후속 턴 히트율 회복)
- [ ] 방안 C — IntentClassifier follow-up 라벨 + 이력 입력
- [ ] 방안 D — 장기 세션 rolling summary (세션이 12메시지 초과로 잘리는 빈도 관찰 후)
