# 부수 S2 — Alembic `DROP TABLE IF EXISTS` 제거 (1ee1295dc7f4)

- **작성일**: 2026-04-25
- **상태**: 완료 (로컬 PG round-trip 실측 PASS)
- **관련 파일**: `backend/alembic/versions/1ee1295dc7f4_add_data_source_categories_table.py`, 플랜 §13.2 S2

## 왜

플랜 §13.2 S2 지적 — 해당 revision 의 `upgrade()` 가 "DROP TABLE IF EXISTS → CREATE → INSERT" 패턴으로, 운영 테이블 대상 파괴적 동작. downgrade → upgrade round-trip 시 사용자 수정 데이터 소실 위험.

`grep "DROP TABLE" backend/alembic/versions/` 결과 이 revision 외 추가 패턴 없음.

## 변경

`backend/alembic/versions/1ee1295dc7f4_add_data_source_categories_table.py` `upgrade()`:

1. L22 `op.execute("DROP TABLE IF EXISTS data_source_categories")` **제거**.
2. `op.get_bind() + sa.inspect()` 로 테이블 존재 여부 확인 후 **부재 시에만** `CREATE TABLE` + `CREATE INDEX`.
3. 시드 `INSERT` 에 **`ON CONFLICT (key) DO NOTHING`** 추가 → 이미 존재하는 row 보존.
4. `downgrade()` 는 그대로 `op.drop_table(...)` — revert 는 파괴적 동작을 의도.

## 실측 시나리오 (로컬 독립 PG `alembic-poc-pg`, 5433)

```
0. docker run -d --name alembic-poc-pg -p 5433:5432 postgres:17-alpine
1. DROP SCHEMA public CASCADE; CREATE SCHEMA public;   — clean slate
2. alembic upgrade head                                 — 모든 migration 적용 (head=7a344c99c625)
3. UPDATE data_source_categories SET description='CUSTOM_TEXT_XYZ' WHERE key='A'
4. alembic stamp 84b935925eaa                           — 1ee1295dc7f4 직전으로 ref 되돌림 (table 유지)
5. alembic upgrade 1ee1295dc7f4                         — 수정된 upgrade() 재실행
6. SELECT key, description FROM data_source_categories
```

### 결과

Step 6:
```
 key |      description       
-----+------------------------
 A   | CUSTOM_TEXT_XYZ       ← 보존됨
 B   | 주요 어록 및 연설
 C   | 기본 교리서
 D   | 동적 프롬프트 인젝션용
```

**PASS**. `ON CONFLICT (key) DO NOTHING` 이 기존 A row 를 건드리지 않았고, `inspector.get_table_names()` 체크가 CREATE 를 스킵.

### 이전 동작 예상

기존 `DROP TABLE IF EXISTS` → `CREATE` → `INSERT` 흐름이면 Step 6에서 A='615권 텍스트 데이터' 로 덮어씌워졌을 것. 운영 환경에서 관리자가 description/color 등을 편집한 내용이 이 revision 재실행 도중 소실되는 시나리오가 구체적으로 구현부에 의해 유발됨.

## 영향 범위

| 시나리오 | 이전 동작 | 개선 후 |
|----------|-----------|---------|
| 신규 환경 (빈 DB) first upgrade | CREATE + 시드 INSERT | 같음 (inspector 부재 → CREATE + 시드) |
| 기존 환경 (revision 이미 applied) | 이 revision 재실행 안 됨 | 같음 |
| round-trip (down → up) | **시드 데이터 덮어쓰기** (기존 수정분 소실) | **기존 row 보존** |
| downgrade | `drop_table` 유지 (의도적 파괴) | 같음 |

## 제약

- `downgrade` 는 여전히 파괴적. revert 시 데이터 날아감 (별개 과제, §21.4 계열).
- `ON CONFLICT (key) DO NOTHING` 은 **key 동일 + 나머지 필드 다름** 시에도 업데이트하지 않음 (의도). 운영 중 시드 스키마/값 변경 필요 시엔 별도 migration 으로 `UPDATE … WHERE key = …` 명시.

## 다음 단계

- 이번 세션 이어서: 선행 #4.1 Alembic batch backfill PoC → 부수 S1 Gemini 클라이언트 단일화 → 부수 S3 프론트 챗봇 폼 중복 제거.
- 자동화된 round-trip 통합 테스트(`tests/test_alembic_round_trip.py`)는 실 PG 의존 + CI 파이프라인 변경 필요하므로 별도 과제. 본 수동 실측으로 로직 검증 충분.
