# ADR-56 — 봇별 동적 추천 질문 (cron + DB 캐시)

- 작성일: 2026-05-10
- 브랜치: `feat/dynamic-suggested-questions`
- 영향 범위: `backend/src/chatbot/`, `backend/scripts/refresh_suggested_questions.py`,
  `admin/src/app/(chat)/page.tsx`, `admin/src/features/chatbot/chat-api.ts`
- 관련 PR: (TBD)

## 배경

채팅 입력 화면 추천 질문 칩 4 개가 모든 봇에 동일하게 하드코딩 (`SUGGESTED_PROMPTS`).
봇이 다양해진 현 시점에서 봇별 학습 자료 차이를 반영 못 함 → 봇별로 다른 추천을
보여달라는 운영자 피드백.

## 결정

각 봇마다 (1) 최근 30 일 사용자 질문 로그 + (2) 그 봇의 RAG 데이터 샘플을 근거로
**3 개의 추천 질문을 매일 cron 갱신**해 `chatbot_configs.suggested_questions` JSONB
에 저장. 프론트는 `GET /chatbots` 응답에 포함된 필드를 사용, 비어있으면 기존 4 개
fallback prompts 노출.

옵션 비교(brainstorm):

| 옵션 | 추천도 | 비고 |
|------|--------|------|
| A. 매일 cron + DB 캐시 | ★★★★★ | 채택. 첫 사용자 latency 0, `cleanup_semantic_cache.py` 패턴 재사용 |
| B. Next.js ISR | ★★☆☆☆ | chat 페이지가 CSR 이라 분리 비용 큼 |
| C. 관리자 수동 버튼만 | ★★★☆☆ | 자동화 X, 봇 늘면 부담 |
| D. Lazy + 7 일 TTL | ★★★☆☆ | 만료 직후 첫 사용자 2~5 초 latency |
| E. A + 수동 버튼 하이브리드 | ★★★★☆ | 옵션 A 운영 후 점진 확장 |

운영 1~2 주 후 운영자가 수동 갱신 필요성 호소하면 옵션 E 로 확장 (admin 봇 편집
페이지에 "지금 갱신" 버튼 추가).

## 데이터 모델

`chatbot_configs` 에 컬럼 2 개 추가 (마이그레이션 `a4b8e9c1d23f`):

```sql
ALTER TABLE chatbot_configs ADD COLUMN suggested_questions JSON NOT NULL DEFAULT '[]'::json;
ALTER TABLE chatbot_configs ADD COLUMN suggested_at TIMESTAMP NULL;
```

## 생성 흐름

`backend/src/chatbot/suggested_service.py:SuggestedQuestionsService.generate_for_bot`:

1. `ChatbotRepository.get_top_queries_for_bot(chatbot_config_id, days=30, limit=10)`
   — `session_messages.role='USER'` + `research_sessions.chatbot_config_id` 조인.
2. `_extract_sources(search_tiers)` — cascading `tiers[].sources` + weighted
   `weighted_sources[].source` union.
3. `RawQdrantClient.scroll(collection_name, scroll_filter, limit=80)` — 봇 학습 자료
   샘플. payload `title` 우선, 없으면 `text[:120]`.
4. **cold-start fallback**: 30 일 질문이 5 건 미만이면 RAG sample 만으로 prompt 구성.
5. Gemini `generate_text()` — JSON 강제 (`{"questions": [...]}`). 코드블록 fence 도
   parser 가 제거.
6. `update_suggested_questions(config, questions)` + `commit()`.

## Cron 트리거

`backend/scripts/refresh_suggested_questions.py` — `cleanup_semantic_cache.py` 와 같은
인프라 무관 패턴. 활성 봇 (`is_active=True`) 모두 순회, 봇별 실패는 격리.

```bash
# Cloud Run job 또는 EC2 cron
30 3 * * * cd /path/backend && uv run python scripts/refresh_suggested_questions.py --execute
```

`cleanup_semantic_cache` 가 03:00 KST 라 30 분 간격 두고 03:30 KST 로 배치.

## 프론트 적용

```tsx
const currentBot = bots.find((b) => b.chatbot_id === selectedBot);
const dynamic = currentBot?.suggested_questions ?? [];
const prompts = dynamic.length > 0 ? dynamic : FALLBACK_PROMPTS;
```

봇 selector 전환 시 자동으로 칩 갱신. 새 봇 (cron 미실행) 은 fallback 4 개 노출.

## 검증 결과 (2026-05-10 로컬)

`uv run python scripts/refresh_suggested_questions.py --bot-id all --execute` 단일 봇
실행 시 약 2 초 (Qdrant scroll + Gemini 1 회). 생성 예시:

```
1. 참부모님께서 말씀하시는 '환태평양 신문명 개벽시대'의 핵심적인 의미와 변화는 무엇인가요?
2. 일상생활 속에서 실천해야 할 '효자와 충신'의 도리는 구체적으로 어떻게 살라는 뜻인가요?
3. 참부모님께서 강조하시는 '도서국가를 살리고 반도를 하나로 묶는' 섭리적 사명은 무엇인가요?
```

도메인 용어 자연 활용, 1 인칭 존댓말, 정확히 3 개. `GET /chatbots` 응답에서
`suggested_questions` + `suggested_at` 필드 정상 노출 확인.

## Follow-up

- Cloud Scheduler 등록 (`docs/06_devops/cloud-scheduler.md` 신규)
- 운영 1~2 주 후 옵션 E 확장 검토 (admin "지금 갱신" 버튼)
- 봇 8 개 × 매일 1 회 = 월 240 회 Gemini 호출 → flash-lite 기준 무시 가능 비용
