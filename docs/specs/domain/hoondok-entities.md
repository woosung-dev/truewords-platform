# 훈독 도메인 명세 — `users` · `daily_readings` · `mission_logs`

> 추가일: 2026-09-16 (S4, [PLAN-HD-001](../../plans/active/2026-09-17-hoondok-mvp.md) §2)
> 관련 API: [훈독 API 명세](../api/hoondok-api.md)
> 소유: `apps/api/app/modules/hoondok/`(daily_readings·mission_logs), `apps/api/app/modules/identity/`(users). PostgreSQL, alembic additive-only(계획 §3)

---

## 공통 규칙

- PK 는 `uuid`(`uuid4`), 타임스탬프 컬럼은 **naive UTC**(`datetime.now(timezone.utc).replace(tzinfo=None)`, asyncpg 호환)이다.
- "오늘"·"날짜" 컬럼(`date`)은 **KST(`Asia/Seoul`) 기준**으로 서버가 계산한다(결정 9). 클라이언트 시간을 신뢰하지 않는다.
- 상태값은 Postgres ENUM 이 아니라 `varchar` + 애플리케이션 검증이다.
- 기존 테이블(`admin_users`, `research_sessions` 등)과 FK 를 맺지 않는다. 훈독 계정은 `AdminUser` 와 완전히 분리한다(`REQ-PWA-008`).
- `[가정]` 라벨이 있는 필드는 Phase 2 구현 시 확정한다.

---

## ENT-HD-001 `users` — 일반 사용자 (Phase 2)

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | uuid | PK | |
| `email` | varchar(255) | unique, not null | 로그인 ID. 소문자 정규화 후 저장 |
| `password_hash` | varchar(255) | not null | bcrypt (`admin/auth.py` 유틸 재사용) |
| `display_name` | varchar(64) | not null | 홈 인사에 쓰는 이름. 실명 강제 없음 |
| `timezone` | varchar(64) | not null, default `Asia/Seoul` | **예약 컬럼.** 베타는 KST 고정이며 읽지 않는다 |
| `consented_at` | datetime | null | 약관·처리방침 동의 시각. 문구 확정 전(`DEC-PWA-001` `[확인 필요]`)에는 NULL |
| `consent_version` | varchar(32) | null | 동의한 문구 버전. 예약 컬럼 — 문구 확정 전에는 API 가 받지 않는다 |
| `created_at` | datetime | not null | |
| `deleted_at` | datetime | null | 소프트 삭제 예약 컬럼. 값이 있으면 로그인·`me` 모두 401. 삭제 API·물리 삭제 주기는 Phase 2 비범위 `[가정: 30일]` |

- 인증: 별도 HttpOnly 쿠키 `hoondok_token`, JWT `aud="hoondok"`, 만료 7일(`HOONDOK_JWT_EXPIRE_MINUTES`). `admin_token` 을 읽지 않는다.
- 이메일은 `strip().lower()` 후 저장·조회한다. 비밀번호는 bcrypt(`admin/auth.py hash_password`).
- 비밀번호 재설정은 베타 기간 운영자 수동(결정 4). 메일 인프라는 없다.

---

## ENT-HD-002 `daily_readings` — 오늘 말씀 편성 (Phase 1)

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | uuid | PK | |
| `reading_date` | date | unique, not null, index | 편성일(KST). 하루 1건 |
| `title` | varchar(200) | not null | 카드 제목 |
| `body` | text | not null | 말씀 본문. 저작물 원문 발췌 |
| `speaker` | varchar(64) | not null | 화자 (AC-016-01 ①) |
| `spoken_on` | varchar(32) | null | 원문 날짜 표기. 정확한 날짜가 없어 문자열 (AC-016-01 ②) |
| `work_title` | varchar(200) | not null | 저작물 (AC-016-01 ③) |
| `edition` | varchar(120) | null | 판본 (AC-016-01 ④) |
| `authority_grade` | varchar(8) | not null | 공식성 등급 `O1`~`O5`, `R`(권리 확인 중) (AC-016-01 ⑤, `DES-PWA-003` §2.3) |
| `review_status` | varchar(16) | not null, default `unverified` | 검수 상태 `reviewed` · `unverified` · `withdrawn` (AC-016-01 ⑥). `withdrawn` 은 화면에 본문을 내지 않는다(AC-016-04) |
| `source_note` | varchar(500) | null | 운영자 수기 출처 메모(페이지·출전 등) |
| `chunk_id` | varchar(128) | null | Qdrant point id. **DB FK 아님.** 원문 열기 연결용이며 Phase 1 화면은 쓰지 않는다 |
| `estimated_minutes` | smallint | not null, default 3 | 예상 읽기 시간 (AC-016-01) |
| `created_at` | datetime | not null | |
| `updated_at` | datetime | not null | |

- 편성 주체는 운영자 1명, N일분 수기 입력(결정 5). Phase 1 은 시드 스크립트로만 채운다. **2026-09-19 확정(Phase 3 A):** 편성자가 비개발자라 운영 입력 수단은 `apps/admin` 편성 화면 + [API-HD-006~008](../api/hoondok-api.md)(`/admin/hoondok/daily-readings`)이다. CSV 안은 폐기, 시드는 로컬·E2E 한정. 삭제 대신 `review_status=withdrawn` 으로 철회한다.
- `featured_malssum.json` 20건은 로컬·E2E 시드에만 쓰고 `review_status=unverified`, `source_note` 에 시드 출처를 남긴다(결정 6).
- 화면 표시: `speaker · work_title · edition · authority_grade` 가 출처 줄, `review_status` 는 `unverified` 일 때 "확인되지 않음" 배지(`badge--dashed`).

---

## ENT-HD-003 `mission_logs` — 미션 완료 기록 (Phase 2)

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | uuid | PK | |
| `user_id` | uuid | FK `users.id`, not null, index | |
| `mission_date` | date | not null | 완료 판정일(KST) |
| `kind` | varchar(16) | not null | `read`(훈독하기) · `pray`(기도하기) · `study`(말씀 읽기) |
| `completed_at` | datetime | not null | 실제 완료 시각(UTC) |
| — | — | unique(`user_id`, `mission_date`, `kind`) | 하루 1회 (AC-016-02) |

- 연속일·최대 연속일·누적일은 저장하지 않고 `mission_logs` 의 `read` 완료일에서 계산한다(API-HD-004, `hoondok/streak.py`). 계산 기준은 KST 자정, "쉬어가기" 면제는 비범위.
- 비로그인 상태의 체크는 클라이언트(localStorage, KST 날짜 키)에만 두고, 로그인 후 소급 기록한다(AC-016-02). API 가 날짜를 받지 않으므로 소급은 **당일만** 가능하다.
- `user_id` 는 같은 Phase 에서 만든 `users.id` FK 다(기존 테이블과의 FK 금지 규칙과 충돌하지 않는다).

---

## 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 3테이블로 축소. 정성·챌린지·관계·설교 도메인은 비범위 | 확정 · 계획 §1-8 |
| 2026-09-16 | KST 고정, `users.timezone` 예약만 | 확정 · 계획 §1-9 |
| 2026-09-16 | `chunk_id` 는 FK 아님, 상태값은 varchar | 확정 · 계획 §3 |
| 2026-09-16 | `users` 확정(alembic `i1e2f3a4b5c6`). `consent_version`·`deleted_at` 은 예약 컬럼 | 확정 · Phase 2 sub-PR A |
| 2026-09-16 | `mission_logs` 확정(alembic `j3f4a5b6c7d8`). 연속일은 `read` 기준 계산, 소급은 당일만 | 확정 · Phase 2 sub-PR B |
