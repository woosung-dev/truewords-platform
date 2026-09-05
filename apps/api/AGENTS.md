# API 작업 지침

루트 AGENTS.md와 [문서 색인](../../docs/README.md)을 먼저 읽는다.

1. `app/main.py`는 앱 조립, `app/core/`는 설정·공통 기반, `app/modules/`는 기존 도메인이다. URL·DB 테이블·Alembic revision·RAG 규칙을 폴더 이름 때문에 변경하지 않는다.
2. Router / Service / Repository 경계를 유지한다. AsyncSession은 Repository에서 사용하고, Pydantic V2·비동기 I/O·서버 측 권한 검사를 유지한다.
3. `contracts/openapi.json`은 `uv run --frozen python scripts/export_openapi.py`로 생성한다. 생성 JSON/SDK를 수동 편집하지 않는다. exporter는 lifespan과 네트워크 없이 동작해야 한다.
4. SSE 데이터 모델은 `app/modules/chat/stream_schemas.py`, 공유 예시는 `contracts/fixtures/chat-stream.json`이다. 실제 이벤트는 `chunk`, `sources`, `done`; HTTP 오류/중도 끊김을 `done`으로 간주하지 않는다.
5. 검증은 `GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen --all-groups pytest -q`와 계약 재생성 검사를 실행한다. paid Gemini 평가와 운영 DB·볼륨 변경은 이 검증에 포함하지 않는다.

## 현재 범위

기존 데모 인증을 보존한다. identity·알림 정책 확장과 Flutter는 별도 승인 작업이다.
로컬 Compose 기본 project는 기존 `backend`다. 격리 검증은 `-p`와 별도 포트 환경변수를 사용하고 기존 볼륨을 삭제하지 않는다.
API 이미지 빌드는 저장소 루트에서 `docker build -f apps/api/Dockerfile .`을 사용한다.
