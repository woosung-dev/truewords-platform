# API 작업 지침

루트 `AGENTS.md`를 먼저 읽고, 필요한 명세는 [문서 색인](../../docs/README.md)에서 찾는다.

1. `app/main.py`는 앱 조립, `app/core/`는 설정·공통 기반, `app/modules/`는 기존 도메인이다. URL·DB 테이블·Alembic revision·RAG 규칙을 폴더 이름 때문에 변경하지 않는다.
2. Router / Service / Repository 경계를 유지한다. AsyncSession은 Repository에서 사용하고, Pydantic V2·비동기 I/O·서버 측 권한 검사를 유지한다.
3. `contracts/openapi.json`은 `uv run --frozen python scripts/export_openapi.py`로 생성한다. 생성 JSON/SDK를 수동 편집하지 않는다. exporter는 lifespan과 네트워크 없이 동작해야 한다.
4. SSE 데이터 모델은 `app/modules/chat/stream_schemas.py`, 공유 예시는 `contracts/fixtures/chat-stream.json`이다. 실제 이벤트는 `chunk`, `sources`, `done`; HTTP 오류/중도 끊김을 `done`으로 간주하지 않는다.
5. 검증은 `GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen pytest -q`와 계약 재생성 검사를 실행한다. paid Gemini 평가와 운영 DB·볼륨 변경은 이 검증에 포함하지 않는다.

6. 훈독 알림은 `app/modules/hoondok/notifications_router.py`(공개 `/hoondok/push/config` + `hoondok_token` 의 `/hoondok/me/notifications`·`/hoondok/me/push`)다. VAPID 3값이 모두 설정되지 않으면 구독은 409 `PUSH_DISABLED` 이며 실제 발송 코드는 이 라우터에 두지 않는다.

7. 훈독 말씀 서고는 `app/modules/hoondok/library_{router,service,repository,schemas,series}.py` 다. 장 목차 추출 규칙은 `section_rules.py`(순수 함수, I/O 없음)에 두고, 1회 실행 스크립트 `scripts/seed_content_rights_from_qdrant.py`(권리 원장 시드)·`scripts/extract_volume_sections.py`(장 목차 추출)가 Qdrant·DB I/O 를 맡는다 — cron 이 아니며 절차는 `infra/oracle-vm/README.md` 다. 목차는 `/hoondok/sections/{volume:path}` 이며 `/hoondok/words/{volume:path}` 가 greedy 라 하위 경로를 쓰지 않는다. 시리즈 admin(`API-HD-027·028`)은 기존 `rights_admin_router.py` 에 둔다.

## RAG·데이터 경계

- 채팅 답변은 기존 RAG 파이프라인과 safety/output filter를 통과시킨다. 검색 근거와 출처를 생략하거나 별도 LLM 직접 호출로 우회하지 않는다.
- 검색 source 필터·캐시 정책을 변경할 때는 현재 코드의 호출 경로와 테스트를 확인한다. `chat/schemas.py`의 Source 필드를 바꾸면 `pipeline/stages/persist.py`의 캐시 저장 필드와 `tests/test_cache_schema_propagation.py`도 함께 확인한다.
- 비밀 값은 환경 설정에서 읽고 API 키·DB 비밀번호는 `SecretStr`로 다룬다. 새 DB 변경은 Alembic revision에 반영하고 데이터 삭제가 필요한 변경은 별도 마이그레이션 절차를 검토한다.

## 현재 범위

기존 데모 인증과 훈독 일반 사용자 인증의 경계를 유지한다. Flutter는 도입 결정 전 추가하지 않는다.
로컬 Compose 기본 project는 기존 `backend`다. 격리 검증은 `-p`와 별도 포트 환경변수를 사용하고 기존 볼륨을 삭제하지 않는다.
API 이미지 빌드는 저장소 루트에서 `docker build -f apps/api/Dockerfile .`을 사용한다.
