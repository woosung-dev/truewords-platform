# 훈독 도메인 명세 — `users` · `daily_readings` · `mission_logs` · `jeongseong_periods`

> 추가일: 2026-09-16 (S4, [PLAN-HD-001](../../plans/active/2026-09-17-hoondok-mvp.md) §2)
> 관련 API: [훈독 API 명세](../api/hoondok-api.md)
> 소유: `apps/api/app/modules/hoondok/`(daily_readings·mission_logs·jeongseong_periods), `apps/api/app/modules/identity/`(users). PostgreSQL, alembic additive-only(계획 §3)

---

## 공통 규칙

- PK 는 `uuid`(`uuid4`), 타임스탬프 컬럼은 **naive UTC**(`datetime.now(timezone.utc).replace(tzinfo=None)`, asyncpg 호환)이다.
- "오늘"·"날짜" 컬럼(`date`)은 **KST(`Asia/Seoul`) 기준**으로 서버가 계산한다(결정 9). 클라이언트 시간을 신뢰하지 않는다.
- 상태값은 Postgres ENUM 이 아니라 `varchar` + 애플리케이션 검증이다.
- 기존 테이블(`admin_users`, `research_sessions` 등)과 FK 를 맺지 않는다. 훈독 계정은 `AdminUser` 와 완전히 분리한다(`REQ-PWA-008`).
- `[가정]` 라벨이 있는 필드는 Phase 2 구현 시 확정한다.
- **프리뷰 셸 화면(`SCR-PWA-007`~`013`·`016`)에는 대응하는 엔티티가 없다.** 말씀 서고·검색·원문·가정예배·설교·가족·친구는 `apps/web/src/features/hoondok/preview/fixtures/` 의 표시용 fixture 뿐이며 테이블·API·네트워크 요청이 하나도 없다(PLAN-HD-002 W3). 실데이터 도입은 권리 원장·Qdrant payload 확장·`DEC-PWA-020`·`DEC-PWA-021` 이 정해진 뒤다.

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
| `deleted_at` | datetime | null | 소프트 삭제. 값이 있으면 로그인·`me` 모두 401. [API-HD-011](../api/hoondok-api.md) `DELETE /hoondok/auth/me` 가 기록하며 `email` 을 `deleted:{id}` 로 익명화해 같은 주소로 재가입할 수 있다(2026-09-19 W0-B). 물리 삭제 주기는 비범위 `[가정: 30일]` |

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
| `chunk_id` | varchar(128) | null | Qdrant point id. **DB FK 아님.** 원문 열기 연결용. Phase 1 화면은 쓰지 않고, 편성 후보 검색([API-HD-012](../api/hoondok-api.md))으로 채운 편성은 여기에 출처 청크를 남긴다 |
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
| — | — | index(`mission_date`, `kind`) `ix_mission_logs_date_kind` | 하루 완료자 수 집계 (API-HD-029, PLAN-HD-009) |

- 연속일·최대 연속일·누적일은 저장하지 않고 `mission_logs` 의 `read` 완료일에서 계산한다(API-HD-004, `hoondok/streak.py`). 계산 기준은 KST 자정, "쉬어가기" 면제는 비범위.
- 비로그인 상태의 체크는 클라이언트(localStorage, KST 날짜 키)에만 두고, 로그인 후 소급 기록한다(AC-016-02). API 가 날짜를 받지 않으므로 소급은 **당일만** 가능하다.
- `user_id` 는 같은 Phase 에서 만든 `users.id` FK 다(기존 테이블과의 FK 금지 규칙과 충돌하지 않는다).
- 계정 삭제([API-HD-011](../api/hoondok-api.md))는 본인 행을 하드 삭제한다.

---

## ENT-HD-004 `jeongseong_periods` — 정성 기간 (W0-B)

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | uuid | PK | |
| `user_id` | uuid | FK `users.id`, not null, index `ix_jeongseong_periods_user_id` | |
| `topic` | varchar(40) | not null | 정성 주제. 앞뒤 공백 제거 후 1~40자 |
| `duration_days` | int | not null | `7` · `21` · `40`. 앱 검증(`Literal`)만, DB CHECK 없음 |
| `started_on` | date | not null | 시작일(KST). 생성 시 오늘 ~ 오늘+30 |
| `reminder_time` | time | null | 표시용 리마인더 시각. 푸시는 Phase 4 |
| `status` | varchar(16) | not null, server_default `active` | `active` · `completed` · `abandoned`. PG ENUM 아님 |
| `ended_at` | datetime | null | `completed`·`abandoned` 로 바뀐 시각(UTC) |
| `created_at` | datetime | not null | |
| `updated_at` | datetime | not null | 상태 전이 때 갱신 |
| — | — | **부분 unique** `uq_jeongseong_periods_user_active` on (`user_id`) `WHERE status = 'active'` | 사용자당 진행 중 1건. `completed`·`abandoned` 행은 여러 건 남는다 |

- **진행률은 저장하지 않는다.** `end_on = started_on + (duration_days - 1)`, `done_days`·`missed_days`·`remaining_days`·`percent`·`state(upcoming·active·completed)` 는 `mission_logs` 의 `read` 완료일에서 매번 계산한다(`hoondok/jeongseong.py`). `missed_days` 는 어제까지만 센다 — 오늘은 밀린 날이 아니다.
- 상태 전이: `active → completed` 는 `end_on < today` 인 상태로 `GET/POST/DELETE /hoondok/me/jeongseong` 이 읽는 시점에 기록한다(배치 없음). `active → abandoned` 는 DELETE. 두 전이 모두 `ended_at`·`updated_at` 을 채운다. 되돌리기는 없다.
- 부분 unique 는 SQLModel `__table_args__` 의 `Index(..., unique=True, postgresql_where=..., sqlite_where=...)` 로 선언해 aiosqlite 테스트에서도 같은 제약을 재현한다. 동시 생성 경쟁은 IntegrityError → 409.
- 계정 삭제([API-HD-011](../api/hoondok-api.md))는 본인 행을 하드 삭제한다.

---

## 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 3테이블로 축소. 정성·챌린지·관계·설교 도메인은 비범위 | 확정 · 계획 §1-8 |
| 2026-09-16 | KST 고정, `users.timezone` 예약만 | 확정 · 계획 §1-9 |
| 2026-09-16 | `chunk_id` 는 FK 아님, 상태값은 varchar | 확정 · 계획 §3 |
| 2026-09-20 | `chunk_id` 가 실제로 쓰이기 시작한다 — 편성 후보 검색(API-HD-012)으로 채운 편성이 출처 청크 id 를 남긴다. 컬럼 변경 없음 | 확정 · PLAN-HD-003 |
| 2026-09-16 | `users` 확정(alembic `i1e2f3a4b5c6`). `consent_version`·`deleted_at` 은 예약 컬럼 | 확정 · Phase 2 sub-PR A |
| 2026-09-16 | `mission_logs` 확정(alembic `j3f4a5b6c7d8`). 연속일은 `read` 기준 계산, 소급은 당일만 | 확정 · Phase 2 sub-PR B |
| 2026-09-19 | `jeongseong_periods` 확정(alembic `k5a6b7c8d9e0`). 사용자당 active 1건은 부분 unique, 상태 varchar, 진행률 미저장. `users.deleted_at` 은 API-HD-011 이 기록하고 이메일을 `deleted:{id}` 로 익명화 | 확정 · PLAN-HD-002 W0-B |
| 2026-09-22 | `notification_preferences`·`push_subscriptions` 신설(alembic `m7c8d9e0f1a2`). 설정은 행 없으면 기본값·PUT 전체 교체, 구독은 `endpoint` unique + 소유 이전, 발송 상태(`last_sent_on`·`failed_count`)는 구독 행에 둔다 | 확정 · PLAN-HD-006 sub-PR A |
| 2026-09-23 | 모임 5테이블 신설(ENT-HD-013~017, alembic `r3c4d5e6f7a8`). 공동 정성은 개인 정성을 확장하지 않고 `shared_jeongseongs`(group_id NULL = 공식)로 분리 | 확정 · PLAN-HD-010 트랙 A |

---

## ENT-HD-005 `content_rights` — 신규 말씀 기능 권리 원장

`volume` unique를 저작물 키로 사용한다. 승인된 메타데이터 조사에서 664개 volume 간 book_series 충돌이 없었다.
`work_title`, `source_keys`, `book_series`, `authority_grade`, `note`, 생성·갱신 시각을 기록한다.
`status`는 varchar이며 `pending`(기본)·`allowed`·`withdrawn`이다. 삭제 대신 철회한다.
`scope_search`, `scope_full_text`, `scope_jeongseong`은 서로 독립적인 bool이며 기본 false다.
각 신규 기능은 allowed와 해당 scope를 모두 만족해야 본문을 반환한다. 기존 AI/오늘 편성의 전면 전환은 후속이다.
`chunk_count`(nullable int, PLAN-HD-007)는 그 권의 Qdrant 청크 수이며 시드 스크립트가 채운다.
미집계와 0을 구분해야 해서 nullable이고, 권리 입력 스키마에는 없어 admin 개별 저장이 값을 덮지 않는다.

## ENT-HD-006 `jeongseong_readings` — 날짜별 정성 추출 말씀

`period_id` FK, `reading_date`, `volume`, `chunk_id`, 본문·제목·출처 메타데이터를 저장한다.
`(period_id, reading_date)` unique로 같은 날 동시 조회도 한 건만 확정한다. 같은 기간에 사용한 chunk_id는 다음 후보에서 제외한다.
미래 시작일에는 생성하지 않으며 후보가 없으면 행을 만들지 않는다. 이미 저장한 말씀도 권리 철회 후 반환하지 않는다.
기간은 ENT-HD-004의 달력 기준을 그대로 사용한다. 결석 시 기간 연장이나 day_index 기반 진도를 추가하지 않는다.
계정 삭제 시 해당 사용자의 기간에 속한 말씀을 함께 삭제한다.

## ENT-HD-007 `client_error_events` — 최소 오류 수집

오류 종류(`sw_register`, `install_prompt`, `unhandled`, `api_5xx`), 고정 안전 문구, 정규화된 경로,
발생 시각과 선택적인 사용자 연결을 기록한다. 원본 예외 메시지·질문·메모·검색어·토큰은 기록하지 않는다.
보고 요청 실패를 다시 수집하지 않으며 사용자 삭제 시 연결된 기록을 삭제한다. 관리자 조회 화면은 만들지 않는다.

## ENT-HD-008 `notification_preferences` — 사용자별 알림 설정 (PLAN-HD-006)

`user_id`가 PK이자 users FK인 1:1 테이블이다. 행이 없으면 기본값(`read_enabled=false`, `read_time='06:00'`,
`lock_screen_level='neutral'`)으로 취급하며 조회만으로 행을 만들지 않는다.
`read_time`은 time 컬럼이고 계약에서는 항상 `HH:MM` 문자열이다. 발송 기준 시간대는 KST 고정이라 사용자별 오프셋을 저장하지 않는다.
`lock_screen_level`은 잠금화면 문구의 수위(`neutral`·`faith`)이며 PostgreSQL ENUM이 아니라 varchar + 앱 Literal 검증이다.
알림 종류는 "훈독하기" 1종뿐이라 종류별 테이블을 만들지 않는다.

## ENT-HD-009 `push_subscriptions` — 브라우저 푸시 구독 (PLAN-HD-006)

`endpoint`는 브라우저가 발급한 전역 식별자라 unique다. 한 사용자가 기기마다 여러 행을 가질 수 있고,
같은 기기를 다른 계정이 다시 구독하면 행을 늘리지 않고 `user_id`를 옮긴다.
`p256dh`·`auth`는 암호화 키이며 `user_agent`는 장애 분류용으로 200자까지만 저장한다.
`last_sent_on`(KST 날짜)과 `failed_count`는 발송기가 갱신한다 — 하루 1회 발송 판정과 만료 구독 정리의 근거다.
구독 성공·실패 이력이나 발송 로그 테이블은 두지 않는다.
계정 삭제 시 두 테이블의 행을 함께 하드 삭제한다(API-HD-011 purger).

이 테이블들은 모두 additive-only migration으로 추가하며 PostgreSQL ENUM이나 기존 컬럼 파괴적 변경을 도입하지 않는다.


## ENT-HD-010 `volume_sections` — 권 안의 장 목차 (PLAN-HD-007)

`volume`(Qdrant payload 원문 그대로) · `position`(권 안의 표시 순서) · `level`(1 편·장, 2 장·절·설교) ·
`title` · `start_chunk_index` · `end_chunk_index` · `spoken_on` · `place` · `origin` 을 갖고
`(volume, position)`이 unique다. 본문 자체는 Qdrant에만 있고 여기에는 **경계만** 둔다.
`level`·`origin`은 PostgreSQL ENUM이 아니라 int/varchar + 앱 Literal 검증이다.
`origin`은 `auto`(본문 규칙 추출)와 `manual`(운영자 수기)이며, 추출 스크립트는 권 단위로
`auto` 행만 전량 교체하고 `manual` 행은 보존한다(`LibraryRepository.replace_auto_sections`).
장을 수기로 입력하지 않으며 미검출 구간은 행을 만들지 않고 웹이 "구간 N"으로 폴백한다.

## ENT-HD-011 `reading_positions` — 이어 읽기 위치 (PLAN-HD-007)

`user_id` FK · `volume` · `chunk_index` · `updated_at`이며 `(user_id, volume)`이 unique다.
권마다 최신 1건만 남기므로 이력 테이블을 두지 않는다. 단위는 Qdrant 청크다.
서버 값이 있으면 서버가 우선이고 없으면 기기 값을 1회 올린다. 비로그인은 기기 값만 쓴다.
원문이 허용되지 않은 권에는 저장하지 않는다(404).

## ENT-HD-012 `passage_marks` — 북마크·형광펜·노트 (PLAN-HD-007)

`user_id` FK · `volume` · `chunk_id`(Qdrant point id, FK 아님) · `chunk_index` · `kind` ·
`color` · `note` · 생성·갱신 시각이며 `(user_id, chunk_id, kind)`가 unique다.
`kind`는 `bookmark`·`highlight`이고 varchar + 앱 Literal 검증이다 — 같은 단락에 북마크와 형광펜을 함께 둘 수 있다.
`color`는 1~3이며 `highlight`는 필수, `bookmark`는 항상 null이다.
노트는 형광펜의 `note`(2000자)로 두고 별도 테이블을 만들지 않는다 — 노트 탭은 `note`가 있는 표시를 모은 것이다.
남의 표시는 조회·수정·삭제 조건에서 `user_id`로 걸러져 접근할 수 없다.

세 테이블 모두 additive-only migration(`n8d9e0f1a2b3`)으로 추가하며 PostgreSQL ENUM이나 기존 컬럼 파괴적 변경을 도입하지 않는다.
계정 하드 삭제(API-HD-011)는 `reading_positions`·`passage_marks`를 함께 지운다(`LibraryRepository` purger).

## ENT-HD-013 `reading_groups` — 소그룹 모임 (PLAN-HD-010)

`id` · `name`(≤20, 별칭 — 교회명 필드·검색·공개 목록 없음) · `kind`(`small_group`, 가족은 후속) · `meeting_time`(표시용, NULL 가능) ·
`invite_code`(Crockford base32 `XXXX-XXXX`, 40bit `secrets`, unique) · `invite_expires_at`(naive UTC, 발급 +30일) · 생성·갱신 시각.
모임당 유효 코드 1개이며 재발급은 덮어쓰기라 이전 코드는 즉시 무효다. 인원 수는 저장하지 않는다.

## ENT-HD-014 `group_members` — 모임원 (PLAN-HD-010)

`id` · `group_id` FK · `user_id` FK · `display_name`(≤12, 앞뒤 공백 제거 후 저장) · `role`(`leader`·`member`, varchar) · `joined_at`.
unique `(group_id, user_id)` · unique `(group_id, display_name)` · 부분 unique 리더 1명(`uq_group_members_group_leader`, `role='leader'`, `postgresql_where`+`sqlite_where`) · index `user_id`.
탈퇴·내보내기는 행 하드 삭제(그 사람 한 줄·반응 포함). 계정 삭제 시 리더는 가장 먼저 들어온 식구에게 이전되고, 없으면 모임이 지워진다.

## ENT-HD-015 `shared_jeongseongs` — 함께 드리는 정성 (PLAN-HD-010)

`id` · `group_id` FK **NULL 가능**(NULL = 공식 정성, 모든 모임에 표시) · `title`(≤40, 모임 정성 입력은 ≤24) · `started_on`(KST) · `duration_days`(1~100, 앱 검증) ·
`source_note`(≤200, 공식) · `created_by_user_id` FK NULL(계정 삭제 시 NULL) · 생성·갱신 시각. index `group_id`.
진행은 저장하지 않는다 — `day_index = (오늘 - started_on) + 1`, 시작 전은 upcoming, 끝난 뒤는 목록에서 빠진다. 개인 정성(ENT-HD-004)과 분리한다.

## ENT-HD-016 `group_shares` — 오늘의 한 줄 (PLAN-HD-010)

`id` · `group_id` FK · `member_id` FK(`group_members`) · `share_date`(KST) · `body`(≤100) · 생성·갱신 시각.
unique `(group_id, member_id, share_date)` = 1인 1일 1줄(덮어쓰기) · index `(group_id, share_date)` · index `member_id`. 오늘 `read` 완료자만 쓸 수 있고 화면에는 오늘 것만 나온다. 30일 뒤 정리 스크립트는 후속.

## ENT-HD-017 `share_reactions` — "함께 머물렀어요" (PLAN-HD-010)

PK `(share_id, member_id)` · `created_at`. 종류 컬럼이 없다(반응 1종). index `member_id`. 반응 수는 한 줄 작성자에게만 내려가고 반응한 사람 목록은 어떤 API 에도 없다.

다섯 테이블 모두 additive-only migration(`r3c4d5e6f7a8`, down `q2b3c4d5e6f7`)으로 추가하며 PostgreSQL ENUM·`ondelete` 를 쓰지 않는다.
삭제 순서는 `GroupRepository` 가 명시한다: `share_reactions → group_shares → shared_jeongseongs(모임) → group_members → reading_groups`.
