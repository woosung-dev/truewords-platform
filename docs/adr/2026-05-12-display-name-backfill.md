# ADR: display_name 자동 채움 및 backfill

## 결정

1. `IngestionJobRepository.upsert_pending` — 신규 생성/재업로드 시 `display_name` 이 `None` 이면 `os.path.splitext(filename)[0]` 으로 자동 채운다. 재업로드 시 기존 편집값(`is not None`)은 덮어쓰지 않는다.
2. Alembic data migration `b5c6d7e8f9a0` — 기존 `display_name IS NULL` 행을 `regexp_replace(filename, E'\\.[^.]+$', '')` 로 일괄 업데이트한다.

## 이유

PR #159 에서 frontend `stripFileExt` fallback 으로 임시 처리했으나, backend 기본값이 없으면 chat 응답에서 항상 `volume` 필드(파일명 원문)를 표시명으로 쓰게 되어 가독성이 낮다. DB 에서 기본값을 보장해두면 frontend fallback 은 방어 코드로만 남는다.

## 트레이드오프

- `os.path.splitext("말씀선집.tar.gz")` → `"말씀선집.tar"` (마지막 확장자만 제거). 운영 파일 패턴상 `.tar.gz` 형태는 없으므로 무해하다고 판단.
- PostgreSQL `regexp_replace` 는 DB 전용 — 프로젝트 전체 `asyncpg` 사용이므로 문제 없음.
- `ingestion_jobs` 는 파일 단위 row (수백~수천 건)이므로 단일 트랜잭션 UPDATE 로 충분.
