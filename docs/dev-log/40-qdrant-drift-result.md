# Dev-log 40 — 선행 #3 운영 Qdrant Schema Drift Probe 실 실행 결과

- **작성일**: 2026-04-25
- **실행 환경**: 사용자 로컬 + 운영 Qdrant Cloud (read-only)
- **상위**: 메인 플랜 §22.7 N4 + 선행 #3 (Qdrant schema drift probe)
- **연관 dev-log**: 33 (probe 뼈대), 39 (staging 결정 reverse → 운영 직접 흐름)

---

## 실행 컨텍스트

PR #52 (staging reverse) 머지 후 운영 직접 흐름 채택. `backend/.env` 의 주석 처리된 운영 secrets (`QDRANT_URL`, `QDRANT_API_KEY`, `DATABASE_URL`) 를 process substitution 으로 임시 export 후 실 실행.

```bash
set -a && source <(grep -E '^# *(QDRANT_URL|QDRANT_API_KEY|DATABASE_URL)=' backend/.env | sed 's/^# *//') && set +a
cd backend && uv run python scripts/qdrant_schema_drift_probe.py --execute \
  --main malssum_poc --cache semantic_cache \
  --report ../reports/qdrant_drift_$(date +%Y%m%d).json
```

**검증**:
- `QDRANT_URL` length: 76자 (운영 Qdrant Cloud URL 형식)
- `QDRANT_API_KEY` length: 176자 (JWT 형식)

---

## 결과

`reports/qdrant_drift_20260425.json`:

```json
[
  {
    "collection": "malssum_poc",
    "missing_in_target": [],
    "extra_in_target": [],
    "type_mismatch": [],
    "is_drift": false
  },
  {
    "collection": "semantic_cache",
    "missing_in_target": [],
    "extra_in_target": ["created_at"],
    "type_mismatch": [],
    "is_drift": true
  }
]
```

### 컬렉션별 상세

#### `malssum_poc` ✅ Drift 없음
- `EXPECTED_MAIN_SCHEMA` = `{source: KEYWORD, volume: KEYWORD}` 와 운영 일치
- `backend/src/qdrant_client.py:create_payload_indexes` 가 두 인덱스를 생성하고, 운영도 그대로 유지

#### `semantic_cache` ⚠ Drift 발견
- `EXPECTED_CACHE_SCHEMA` = `{chatbot_id: KEYWORD}`
- 운영 실제: `{chatbot_id: KEYWORD, created_at: <some_type>}`
- **extra_in_target**: `created_at` — EXPECTED 에 없지만 운영에 존재

---

## 해석

### `created_at` 인덱스의 정체

가능한 출처 (소스에서 확인 필요):
1. `backend/src/cache/service.py` 또는 cache 컬렉션 초기화 코드에서 명시적으로 생성
2. Qdrant Cloud 자동 인덱싱 (확률 낮음)
3. 과거 코드/스크립트에서 일회성으로 추가 후 EXPECTED 미반영
4. cache TTL 정리 (older entries 삭제) 효율을 위한 인덱스 — `cache_ttl_days = 7` 설정 (config.py L41) 과 연관 가능

→ **drift 자체는 "운영에 추가 인덱스가 있고, EXPECTED 가 그걸 반영 못 함"** 이라는 정합성 갭. 실제 동작 영향 0 (extra index 는 read 성능에 보조적).

### `is_drift: true` 의미

스크립트가 정의한 drift 범주 (`extra_in_target` 포함) 에 따라 true. 그러나 **운영 안전성 위협 0** — extra index 는 missing 보다 훨씬 안전한 상태.

---

## 후속 결정 옵션 (별도 PR 또는 ticket)

| 옵션 | 액션 | 근거 |
|------|------|------|
| **A. EXPECTED 갱신** (Recommended) | `EXPECTED_CACHE_SCHEMA` 에 `created_at` 추가 + payload schema type 확인 | 운영이 truth source. EXPECTED 를 운영에 맞춤. R3 후속 PR (Collection Resolver) 에서 일괄 정리 가능 |
| **B. 운영 인덱스 정리** | 운영 `semantic_cache` 에서 `created_at` 인덱스 제거 | `created_at` 이 cache TTL 정리에 사용 중이면 성능 저하 가능 |
| **C. 보류** | 다음 R3 후속 PR 시점에 다시 평가 | 현재 운영 정상 작동, 우선순위 낮음 |

**추천**: A — R3 후속 PR (Collection Resolver) 의 sub-task 로 EXPECTED 정의를 운영과 동기화.

---

## 메인 플랜 §22.7 N4 의 이전 의도

플랜 §22.7 N4 의 핵심: **Alembic head artifact + ALEMBIC_EXPECTED_HEAD** 으로 Postgres schema 일관성 검증. Qdrant 측은 본 probe 가 보완.

본 #3 결과로:
- ✅ Postgres (Alembic head artifact) — N4 완료 (PR #42)
- ✅ Qdrant main (`malssum_poc`) — drift 없음 확인
- ⚠ Qdrant cache (`semantic_cache`) — drift 발견, 후속 PR 에서 EXPECTED 갱신

→ 다음 sprint (R3 후속 또는 R1) 에서 EXPECTED 갱신 PR 1건 추가하면 N4 의 Qdrant 측 보완 완성.

---

## 다음 단계

1. **선행 #5 운영 chat API baseline 200건** — 별도 세션. 비용 ~$1~3 + analytics 영향. baseline ID prefix 분리 검토 필요.
2. **R3 후속 PR (Collection Resolver)** — multi-collection 지원 + EXPECTED_CACHE_SCHEMA 갱신 sub-task 포함
3. **R1 Phase 1** — baseline 200건 수집 후

---

## 메인 플랜 §23 준수

- 검증 루프: 1회 (한 번의 실행으로 결과 확보).
- 문서 분량: 약 110줄 / 임계 2,000줄 충분 여유.
- Δ 누적: 1 (semantic_cache extra index 발견). 후속 PR 로 cleanup. 한도 미접근.
