# dev-log 52 — `collection_main` 봇별 컬렉션 토글 폐기

- **날짜:** 2026-04-30
- **상태:** Phase 1 완료 (코드 사용 중단). Phase 2 (DB 컬럼 drop) 보류
- **관련:** dev-log 47/48/49/50/51 (Phase 2.x 청킹 비교 및 v5 운영 채택)

## 배경

Phase 2.x (옵션 B Anthropic Contextual Retrieval / 옵션 F 청킹 비교) 시점에
`ChatbotConfig.collection_main` 컬럼과 봇 폼 select UI를 도입했다. 봇별로
다른 Qdrant 컬렉션(v2 / v3 / chunking_poc_*)을 가리키게 하여 A/B 비교를
수행하기 위함이었다.

Phase 2.4 (dev-log 51) 에서 v5 (Recursive 88권) 운영 채택이 확정되며
`env COLLECTION_NAME=malssum_poc_v5` 단일 컬렉션 운영으로 전환됐다.
그러나 봇 폼의 collection_main select와 `ChatbotConfig.collection_main`
컬럼은 그대로 남아 있어 다음 모순이 발생했다:

1. **적재 측에는 컬렉션 선택 UI가 없음.** 어드민 `/data-sources/upload` 는
   `settings.collection_name` (env 단일값) 으로만 적재한다.
2. **봇 폼 select 옵션이 운영 컬렉션과 어긋남.** prod Qdrant 에는
   `malssum_poc` 1개와 `semantic_cache` 만 존재 (마이그레이션 미수행).
   select 옵션의 v2/v3/chunking_poc_* 는 prod 에 없다.
3. **백엔드 default(v5)가 select 옵션에 없음.** 봇별로 v5 를 명시적으로
   고를 수도, env 기본값으로 위임할 수도 없는 어정쩡한 상태.

## 결정

봇별 컬렉션 토글을 폐기한다. 모든 봇은 `settings.collection_name` 단일
컬렉션을 공유하며, A/B 청킹 비교는 `backend/scripts/` PoC 스크립트와
별도 PoC 컬렉션으로 한정한다.

## Phase 1 (이번 PR — 코드 사용 중단)

**Frontend**
- `admin/src/features/chatbot/components/chatbot-form.tsx` — "Qdrant 메인 컬렉션" select 블록 제거
- `admin/src/features/chatbot/types.ts` / `api.ts` / `[id]/edit/page.tsx` — `collection_main` 필드 제거

**Backend**
- `backend/src/chatbot/runtime_config.py` — `SearchModeConfig.collection_main / collection_cache` 제거
- `backend/src/chatbot/service.py` — `build_runtime_config` 조립부에서 collection_main 라인 제거
- `backend/src/chatbot/schemas.py` — `ChatbotConfigResponse / Create / Update` 에서 제거
- `backend/src/search/collection_resolver.py` — `settings.collection_name` 직접 사용으로 단순화. 시그니처는 호출부 호환을 위해 `ChatbotRuntimeConfig` 인자를 유지 (현재 미사용)
- `backend/src/chatbot/models.py` — `ChatbotConfig.collection_main` 컬럼은 deprecation 주석만 추가 (Phase 2 에서 drop 예정)
- `backend/scripts/seed_chatbot_configs.py` — collection_main kwargs 제거. PoC 봇 (`chunking-*`, `all-paragraph`) 은 description 만 `[DEPRECATED]` 표기하고 보존 (실 데이터 정리는 Phase 2)

**Tests**
- `backend/tests/chatbot/test_collection_main_field.py` 삭제
- `backend/tests/chatbot/test_collection_main_routing.py` 삭제
- `backend/tests/test_collection_resolver.py` — settings 기본값 반환 1개 테스트로 단순화
- `backend/tests/test_chatbot_runtime_config_factory.py` / `test_chatbot_weighted_config.py` — stub 의 collection_main 라인 제거

검증: backend pytest 599 passed / admin Vitest 43 passed / TypeScript typecheck clean.

## Phase 2 (다음 배포 — DB 컬럼 drop)

backend.md 의 2단계 배포 규칙에 따라, 컬럼 drop 은 다음 배포로 분리한다.

1. Phase 1 코드가 prod 에 안정 배포된 것을 확인 (1주 이상 권장)
2. Alembic 마이그레이션으로 `chatbot_configs.collection_main` 컬럼 drop
3. `backend/src/chatbot/models.py` 에서 컬럼 정의 + deprecation 주석 제거
4. `seed_chatbot_configs.py` 의 PoC 봇 (`chunking-*`, `all-paragraph`) 시드 데이터 제거
5. `backend/src/search/collection_resolver.py` 의 더미 인자 제거 (호출부 시그니처 일괄 변경)

## 참고

- Phase 2.4 v5 운영 채택: dev-log 51 (`51-recursive-v5-88vol-promotion.md`)
- prod Qdrant 마이그레이션 정책: local→prod 직접 전송 (Cloudflare Tunnel 경유) — `qdrant.woosung.dev` 의 컬렉션 목록은 의도적으로 운영용만 보존
