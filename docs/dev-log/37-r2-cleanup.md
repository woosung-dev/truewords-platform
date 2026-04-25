# Dev-log 37 — R2 후속 cleanup (PR #50 후보)

- **작성일**: 2026-04-25
- **브랜치**: `chore/r2-cleanup`
- **상위**: PR #49 (R2 ChatbotRuntimeConfig 본 리팩토링) 머지 직후 cleanup
- **연관 플랜**: `sleepy-sleeping-summit.md` §10.5 (R2 후속 정리), `polymorphic-scribbling-bengio.md` Track A1

## Context

PR #49 가 `ChatbotRuntimeConfig` 단일 객체를 도입하며 `build_runtime_config` 팩토리를 신설했지만, 구 경로(`get_search_config`, `_parse_search_config`) 와 `SYSTEM_PROMPT` alias 가 잔존. 다음 PR 들이 두 경로를 동시에 의식해야 했으므로 단일 진실 원점 확보를 위한 cleanup.

추가로 탐색 중 **PR #49 의 weighted 모드 잠재 회귀** 발견:
- `build_runtime_config` (chatbot/service.py L130) 가 `raw.get("weights", {})` 를 읽지만 DB JSONB 의 정식 키는 `weighted_sources` (list[dict]) — 불일치로 빈 weights 만 들어감
- `SearchModeConfig.weights: dict[str, float]` 에는 score_threshold 가 없으므로 `_to_search_config` 의 weighted 분기에서 score_threshold 정보를 잃어버림
- 결과: weighted 모드가 사실상 깨진 상태로 머지됨 (PoC 단계라 운영 영향 없음)

본 cleanup 에서 **회귀 차단을 위해 SearchModeConfig 모델을 보강**해 함께 수정.

## 변경 요약 (3 commits)

### Commit 1 (`f5819db`) — `_to_search_config` 통합 + `SearchModeConfig.weighted_sources` 보강

- `runtime_config.py`:
  - `WeightedSourceConfig` 신규 모델 (frozen, source/weight/score_threshold)
  - `SearchModeConfig.weights: dict[str, float]` 제거 → `weighted_sources: list[WeightedSourceConfig]`
- `chatbot/service.py` `build_runtime_config`: DB raw `weighted_sources` 키 정확 매핑 (score_threshold 보존). `search_mode` 키도 받도록 (DB 정식 키 = `search_mode`, 이전 PR #49 의 `mode` 키도 호환)
- `chat/service.py` `_to_search_config`: `smc.weighted_sources` 순회로 weighted 분기 통합. `WeightedSource(source, weight, score_threshold)` 모두 전달
- `tests/test_runtime_config_models.py`: `assert smc.weights == {}` → `assert smc.weighted_sources == []`

### Commit 2 (`c92d711`) — `get_search_config` / `_parse_search_config` 제거 + dead mock 정리

- `chatbot/service.py`:
  - `get_search_config` 메서드 제거
  - `_parse_search_config` 메서드 제거
  - 부수 상수 3종 (`DEFAULT_CASCADING_CONFIG`, `DEFAULT_RERANK_ENABLED`, `DEFAULT_QUERY_REWRITE_ENABLED`) 제거
  - 미사용 import (`CascadingConfig`, `SearchTier`, `WeightedConfig`, `WeightedSource`, `SearchTiersConfig`) 제거
- 테스트 갱신:
  - `test_chatbot_config.py`: get_search_config 단위 테스트 3건 삭제 + 미사용 import 정리
  - `test_chatbot_weighted_config.py`: `_parse_search_config` 직접 호출 5건을 `build_runtime_config` 경유로 갱신 + `_to_search_config` 통합 흐름 회귀 검증 1건 추가
  - `test_chat_service.py` / `test_chat_stream_service.py` / `test_cache_integration.py` / `test_safety_integration.py`: ChatService 가 더 이상 호출하지 않는 dead mock 8건 + 변수 5개 + import 3건 정리

### Commit 3 (이번 commit) — `SYSTEM_PROMPT` alias 제거 + dev-log 37

- `chat/prompt.py`:
  - `SYSTEM_PROMPT = """..."""` → `DEFAULT_SYSTEM_PROMPT = """..."""` (정식 이름으로 본체화)
  - `DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT` alias 정의 + 후방 호환 주석 3줄 제거
- `tests/test_generator.py`: `SYSTEM_PROMPT` import / 사용 3곳 → `DEFAULT_SYSTEM_PROMPT`

## 검증 evidence

```bash
# 단위
$ uv run pytest tests/test_runtime_config_models.py \
    tests/test_chatbot_weighted_config.py \
    tests/test_chatbot_config.py \
    tests/test_chatbot_runtime_config_factory.py \
    tests/test_generator.py -x
42 passed (commit 1 직후)

# 전체 회귀
$ uv run pytest -x
394 passed → 391 passed, 1 xfailed (의도된 -3: get_search_config 테스트 3건 삭제)

# 잔존 검증
$ rg "get_search_config|_parse_search_config" backend/src --type py
0건

$ rg "DEFAULT_CASCADING_CONFIG|DEFAULT_RERANK_ENABLED|DEFAULT_QUERY_REWRITE_ENABLED" backend/src --type py
0건

# chat/prompt.py 의 SYSTEM_PROMPT alias (다른 컨텍스트의 RERANK_/SUGGEST_/REWRITE_ 는 무관)
$ rg "^SYSTEM_PROMPT|from src.chat.prompt import.*SYSTEM_PROMPT[^_]" backend/src backend/tests --type py
0건
```

## 회귀 차단 포인트 (회피된 사고)

1. `_parse_search_config` 가 갖던 score_threshold 변환 책임을 `_to_search_config` 가 흡수. WeightedConfig 의 sources 가 score_threshold 까지 보존 (dataclass 기본값 0.1 fallback 이 아닌 DB 사용자 정의값 보존).
2. `build_runtime_config` 가 DB 정식 키 `weighted_sources` 를 읽도록 수정 — 이전엔 잘못된 `weights` 키를 읽어 weighted 모드가 빈 sources 로 만들어졌던 잠재 회귀 차단.

## 후속 항목 (본 PR 스코프 외 — §23 원칙 4 "완벽보다 진행")

| 항목 | 위치 | 비고 |
|------|------|------|
| `ChatbotConfig` DB 모델에 `model_name`, `temperature` 컬럼 추가 | `chatbot/models.py` + Alembic | §10.5 따라 R3 후속 sprint 로 이연. 현재 `GenerationConfig` 기본값으로 운영 |
| `dictionary_enabled` 동적 주입 구현 | `chat/service.py` | `dictionary_collection` 데이터 미확보로 보류 (메모리 `project_terminology_blocked.md`) |
| `chatbot/service.py` `build_runtime_config` 의 `"ChatbotRuntimeConfig | None"` forward ref Pyright 경고 | `chatbot/service.py` L49 | `from __future__ import annotations` 또는 TYPE_CHECKING 으로 정리 가능. 동작 영향 0 |
| `chatbot/service.py` `update` 메서드의 `data.search_tiers.model_dump()` Optional 추적 한계 | `chatbot/service.py` L151 | Pyright 가 isinstance 분기를 추적 못함. 동작 정상 |
| 4개 통합 테스트 파일의 `chatbot_config_id=1` 형식 type 경고 (UUID 기대) | tests/* | 본 cleanup 영향 외 사전 issue. 별도 PR |

## 메인 플랜 §23 준수 점검

- 검증 루프: commit 당 1회 (red→green→commit). 3회 상한 미접근.
- 문서 분량: 본 dev-log 약 90줄 / 임계 2,000줄 충분 여유.
- Δ 누적: 회귀 차단 보강 1건 (Δ1: SearchModeConfig.weighted_sources). 3개 미달, 진행.
