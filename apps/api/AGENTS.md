# API 작업 지침

루트 `AGENTS.md`를 먼저 읽고, 필요한 명세는 [문서 색인](../../docs/README.md)에서 찾는다.

1. `app/main.py`는 앱 조립, `app/core/`는 설정·공통 기반, `app/modules/`는 기존 도메인이다. URL·DB 테이블·Alembic revision·RAG 규칙을 폴더 이름 때문에 변경하지 않는다.
2. Router / Service / Repository 경계를 유지한다. AsyncSession은 Repository에서 사용하고, Pydantic V2·비동기 I/O·서버 측 권한 검사를 유지한다.
3. `contracts/openapi.json`은 `uv run --frozen python scripts/export_openapi.py`로 생성한다. 생성 JSON/SDK를 수동 편집하지 않는다. exporter는 lifespan과 네트워크 없이 동작해야 한다.
4. SSE 데이터 모델은 `app/modules/chat/stream_schemas.py`, 공유 예시는 `contracts/fixtures/chat-stream.json`이다. 실제 이벤트는 `chunk`, `sources`, `done`; HTTP 오류/중도 끊김을 `done`으로 간주하지 않는다.
5. 검증은 `GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen pytest -q`와 계약 재생성 검사를 실행한다. paid Gemini 평가와 운영 DB·볼륨 변경은 이 검증에 포함하지 않는다.
6. `/hoondok/words/{volume:path}`는 하위 경로까지 잡는 greedy 라우트다. 그 아래에 경로를 만들지 않고 목차처럼 별도 접두(`/hoondok/sections/{volume:path}`)를 쓴다.
7. 테스트는 Google TTS를 호출하지 않는다. conftest가 `GOOGLE_TTS_API_KEY`를 비워 낭독을 끈다.

## RAG·데이터 경계

- 채팅 답변은 기존 RAG 파이프라인과 safety/output filter를 통과시킨다. 검색 근거와 출처를 생략하거나 별도 LLM 직접 호출로 우회하지 않는다.
- 검색 source 필터·캐시 정책을 변경할 때는 현재 코드의 호출 경로와 테스트를 확인한다. `chat/schemas.py`의 Source 필드를 바꾸면 `pipeline/stages/persist.py`의 캐시 저장 필드와 `tests/test_cache_schema_propagation.py`도 함께 확인한다.
- 비밀 값은 환경 설정에서 읽고 API 키·DB 비밀번호는 `SecretStr`로 다룬다. 새 DB 변경은 Alembic revision에 반영하고 데이터 삭제가 필요한 변경은 별도 마이그레이션 절차를 검토한다.

## 현재 범위

기존 데모 인증과 훈독 일반 사용자 인증의 경계를 유지한다. Flutter는 도입 결정 전 추가하지 않는다.
로컬 Compose 기본 project는 기존 `backend`다. 격리 검증은 `-p`와 별도 포트 환경변수를 사용하고 기존 볼륨을 삭제하지 않는다.
API 이미지 빌드는 저장소 루트에서 `docker build -f apps/api/Dockerfile .`을 사용한다.
