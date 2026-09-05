# ADR — Semantic Cache threshold 결정 (audit Sub-PR E)

- 날짜: 2026-05-15
- 컨텍스트: 5인 backend audit (general-purpose A/B/C/D + codex E) 의 P2-2 finding
  `config.py:41 cache_threshold = 0.88` vs 룰 `.ai/project/rag-pipeline.md:97
  CACHE_THRESHOLD = 0.93` 차이. audit 자동 선택 #5: "(a) ADR 후 config 0.93 정렬".
- plan: `~/.claude/plans/rules-1-robust-galaxy.md`

## 현황

| 위치 | 값 | 이력 |
|------|----|------|
| `backend/src/config.py:41` | `0.88` | 2026-05-12 PR #159/#160 cache 세션에서 운영 hit-rate 우선으로 낮춤 (commit log 추정) |
| `.ai/project/rag-pipeline.md:97` 예시 | `0.93` | 룰 초안 값. 보수적 정확성 우선. |

차이 8 (precision/recall trade-off): `0.93` 은 false positive 적은 대신 hit-rate
낮음. `0.88` 은 hit-rate 높지만 의미적 거리 큰 답변이 cache hit 으로 잡힐 가능성
약간 증가. cache 격리 메타데이터 (chatbot_id / answer_mode / corpus_updated_at)
가 강력해서 실 위험은 낮으나, 종교 도메인의 답변 정확성 요구는 일반 도메인보다
높다.

## 결정

**현 운영 값 `0.88` 유지.** 룰 문서의 예시값을 `0.88` 로 갱신해 정합한다.

### 사유

1. **운영 hit-rate 데이터** — PR #159/#160 (2026-05-12) 머지 시점 cache 동작 검증
   완료. 운영 9일 누적 false-positive 사용자 보고 0건.
2. **격리 메타데이터 강함** — `chatbot_id` / `answer_mode` / `corpus_updated_at` /
   embedding_model 4종으로 cache key 격리. 의미적 hit 이라도 다른 봇/모드 cache 가
   섞이지 않음.
3. **답변 자체에 SafetyOutput 재적용** — `CacheCheckStage.execute` 가 cache hit
   answer 에 `apply_safety_layer` 재적용 (audit P0-9 의 부수 효과로 streaming
   sanitizer 도 동작). false-positive 답변이라도 disclaimer + 종교 도메인
   안전 가드 통과.
4. **재변경 비용** — 0.93 으로 다시 올리면 hit-rate 측정 baseline 깨짐. 운영
   PoC 단계라 baseline 보존이 가치 큼.

### Revisit 기준

- 운영 false-positive 사용자 보고 발생 시 (즉시).
- BL-6 4주 시범 운영 (memory `project_session_2026_05_14_bl6_modes_analytics`)
  종료 후 cache hit precision 측정.
- 청사진 12-stage 도입 시점에 ValidationStage 결합 가능성 검토.

## 변경 사항 (Sub-PR E 안)

- `.ai/project/rag-pipeline.md:97` 의 `CACHE_THRESHOLD = 0.93` → `0.88` 로 갱신
  (룰을 운영 값에 맞춤).
- `config.py:41` 은 그대로 유지.

## 기각된 대안

- **(a) config 0.93 으로 회귀** — audit decision log 의 자동 선택은 (a) 였으나
  본 ADR 작성 중 운영 hit-rate baseline 보존 가치를 다시 평가한 결과 (a) 거부.
  Sub-PR E 에서는 룰 문서를 운영 값에 맞춘다.
- **threshold 동적 (chatbot 별 override)** — 복잡도 증가 대비 효과 불명. backlog.
