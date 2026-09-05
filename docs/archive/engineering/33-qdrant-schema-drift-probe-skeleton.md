# dev-log 33 — Qdrant schema drift probe 뼈대 (선행 #3)

- **작성일**: 2026-04-25
- **브랜치**: `feat/prereq-3-qdrant-drift-probe-skeleton`
- **실행 전제**: staging 프로비저닝 (§9.1~§9.2) 완료

## 1. 목적

운영 malssum_poc / semantic_cache 와 staging 컬렉션의 payload_schema 가 동일한지 사전 검증. §21.7 B2 "schema drift detection" 목적으로 재정의.

## 2. 설계

- 기대 스키마는 `backend/src/qdrant_client.create_payload_indexes` 와 수동 동기화 (최소 테스트로 보장).
- `qdrant-client 1.17 payload_schema` 는 `dict[str, PayloadIndexInfo]` 구조. `idx.data_type` 가 `PayloadSchemaType` enum.
- drift 3분류: missing_in_target / extra_in_target / type_mismatch.
- `--dry-run` 기본, `--execute` 시 JSON 리포트 파일 출력. 쓰기 작업(`create_payload_index`) 은 스크립트 스코프 외 — 기존 `cache/setup.ensure_cache_collection` 패턴에 위임.
- drift 감지 시 exit code 1 → CI 게이트로 활용 가능.

## 3. 테스트 인프라 Δ

플랜은 `backend/tests/scripts/__init__.py` 생성을 지시했으나 실제 실험 결과 **오히려 해로움**:
- pytest `pythonpath=["."]` + namespace package 로 `scripts.qdrant_schema_drift_probe` 가 이미 인식됨
- `tests/scripts/__init__.py` 를 두면 pytest 가 `tests.scripts` regular package 로 취급 → 최상위 `scripts` namespace 와 충돌 → `ModuleNotFoundError`
- **결정**: `tests/scripts/` 는 namespace 형태로만 유지 (어떤 `__init__.py` 도 추가하지 않음). `scripts/` 역시 동일.
- 이후 M2 테스트 디렉토리 동일 규칙 적용.

## 4. 테스트 결과

단위 10건 PASS:
- 기대 스키마 상수 2건(main/cache)
- compare_schemas 3분류 4건(missing/extra/mismatch/no-drift)
- fetch_actual_schema 래퍼 1건(mock 기반)
- argparse 3건(mode required, dry-run defaults, execute+custom)

실행: `cd backend && uv run pytest tests/scripts/test_qdrant_schema_drift_probe.py -v` → 10 passed.

Dry-run smoke: `QDRANT_URL= uv run python scripts/qdrant_schema_drift_probe.py --dry-run` → `RuntimeError: QDRANT_URL 환경변수가 필요합니다.` (기대 동작).

## 5. staging 이후 실행 절차

```bash
export QDRANT_URL=https://<cluster>.qdrant.io:6333
export QDRANT_API_KEY=...
uv run python scripts/qdrant_schema_drift_probe.py --execute --report reports/qdrant_drift.json
```

expected exit 0 (drift 없음). drift 가 있으면 `reports/qdrant_drift.json` 을 확인하여 staging 컬렉션 생성 스크립트 보강.

## 6. 후속

- staging 완료 후 본 스크립트를 `.github/workflows/staging-smoke.yml` 에 추가 검토 (선택).
- 본 리팩토링 R3(Payload 통일) 에서 기대 스키마가 바뀌면 `EXPECTED_MAIN_SCHEMA` 갱신 + dev-log 추가.
