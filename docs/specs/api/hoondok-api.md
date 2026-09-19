# 훈독 API 명세 — `/hoondok/*` · 편성 admin `/admin/hoondok/*`

> 추가일: 2026-09-16 (S4, [PLAN-HD-001](../../plans/active/2026-09-17-hoondok-mvp.md) §2)
> 관련 도메인: [훈독 도메인 명세](../domain/hoondok-entities.md)
> 원본: FastAPI 라우트·Pydantic 모델. `contracts/openapi.json` 과 `packages/api-client-ts` 는 `pnpm contracts:generate` 로만 갱신한다

---

## 엔드포인트 목록

| ID | Method | Path | 인증 | Phase |
|---|---|---|---|---|
| `API-HD-001` | GET | `/hoondok/today` | 없음(공개) | 1 |
| `API-HD-002` | POST | `/hoondok/auth/signup` | 없음 | 2 |
| `API-HD-003` | POST | `/hoondok/auth/login` · POST `/hoondok/auth/logout` · GET `/hoondok/auth/me` | login 없음 / logout·me 는 `hoondok_token` | 2 |
| `API-HD-004` | GET | `/hoondok/me/summary` | `hoondok_token` | 2 |
| `API-HD-005` | POST | `/hoondok/missions/{kind}/complete` | `hoondok_token` | 2 |
| `API-HD-006` | GET | `/admin/hoondok/daily-readings` · GET `/admin/hoondok/daily-readings/{id}` | `admin_token` + `require_admin_gate` | 3 |
| `API-HD-007` | POST | `/admin/hoondok/daily-readings` | `admin_token` + 게이트 + `X-Requested-With` | 3 |
| `API-HD-008` | PUT | `/admin/hoondok/daily-readings/{id}` | `admin_token` + 게이트 + `X-Requested-With` | 3 |
| `API-HD-009` | GET · POST · DELETE | `/hoondok/me/jeongseong` | `hoondok_token` (POST·DELETE 는 `X-Requested-With`) | W0-B |
| `API-HD-010` | GET | `/hoondok/me/history?month=YYYY-MM` | `hoondok_token` | W0-B |
| `API-HD-011` | DELETE | `/hoondok/auth/me` | `hoondok_token` + `X-Requested-With` | W0-B |

공통 규칙:

- 라우터 prefix `/hoondok`, tag `hoondok`. `apps/api/app/main.py` 의 **공개 라우터 블록**에 등록한다(`require_admin_gate` 미적용).
- 인증 쿠키는 `hoondok_token`(HttpOnly, `COOKIE_SECURE` 준수). `admin_token` 은 어떤 훈독 엔드포인트에서도 읽지 않는다.
- 날짜(`date`)는 `YYYY-MM-DD`, 서버가 KST 로 계산한다. 클라이언트가 날짜를 보내는 파라미터는 없다.
- 오류 본문은 기존 FastAPI 규약(`{"detail": ...}`)을 따른다. 예외: API-HD-002 의 403 `INVITE_REQUIRED` 는 중앙 핸들러의 `ErrorResponse{ error_code, message, request_id }` 형식이다(SEC-MONO-001 의 `SESSION_FORBIDDEN` 과 같다) — 웹이 CSRF 403 과 `error_code` 로 구분한다.
- Phase 2 항목은 2026-09-16 sub-PR A(002·003)·B(004·005)에서 확정했다.
- `API-HD-006~008` 만 예외로 **관리자 블록**이다: prefix `/admin/hoondok/daily-readings`, tag `admin-hoondok`, `main.py` 에 `_ADMIN_GATE` 로 등록, 라우터 레벨 `verify_csrf`. 훈독 사용자 쿠키(`hoondok_token`)로는 호출할 수 없다. 2026-09-19 Phase 3 sub-PR A 에서 확정.
- `API-HD-009~011` 은 2026-09-19 PLAN-HD-002 W0-B 에서 확정했다(정성 기간·월 기록·계정 삭제). 모두 `hoondok_token` 이며 상태 변경(POST·DELETE)은 `X-Requested-With` 가 없으면 403.

---

## API-HD-001 `GET /hoondok/today` (Phase 1)

오늘(KST) 편성된 말씀 1건을 돌려준다. 없거나 철회됐으면 대체 콘텐츠를 만들지 않고 상태만 알린다(AC-016-04).

### 요청

```
GET /hoondok/today
```

파라미터 없음.

### 응답 (200 OK) — 항상 200

```json
{
  "date": "2026-09-17",
  "status": "available",
  "reading": {
    "id": "6f1c…",
    "reading_date": "2026-09-17",
    "title": "참사랑은 직단거리를 갑니다",
    "body": "…",
    "speaker": "참아버님",
    "spoken_on": "1987-03-01",
    "work_title": "천성경",
    "edition": "최종본 2012년~",
    "authority_grade": "O1",
    "review_status": "reviewed",
    "estimated_minutes": 3
  }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `date` | string | 서버가 계산한 KST 오늘 |
| `status` | `"available"` \| `"none"` \| `"withdrawn"` | `none` = 편성 없음, `withdrawn` = `review_status=withdrawn` |
| `reading` | object \| null | `status=available` 일 때만 non-null. `source_note`·`chunk_id`·타임스탬프는 노출하지 않는다 |

`reading` 필드는 `ENT-HD-002` 의 공개 컬럼과 같다.

### 오류

- 없음(DB 장애는 500).

### 화면 규칙

- `available`: 홈 말씀 카드 + 훈독하기 본문·출처 줄(화자·날짜·저작물·판본·등급 배지)·`unverified` 면 "확인되지 않음" 배지.
- `none` · `withdrawn`: "오늘 말씀이 아직 없어요" 상태 카드 + 다음 행동 안내. Phase 1 은 서고·검색 화면이 없으므로 링크 없이 문구만 `[가정]`.

---

## API-HD-002 `POST /hoondok/auth/signup` (Phase 2)

요청 `{ email, password, display_name, invite_code? }` → 201 `{ user: { id, email, display_name } }` + `Set-Cookie: hoondok_token`(HttpOnly, `Path=/`, `Max-Age` = `HOONDOK_JWT_EXPIRE_MINUTES`×60, 기본 7일). 409 이메일 중복(대소문자 무시, 동시 가입 경쟁도 409), 422 검증 실패(이메일 형태 `로컬@도메인.tld`·비밀번호 8~128자·이름 1~64자). 약관 문구(`DEC-PWA-001` `[확인 필요]`) 확정 전이라 `consent_version` 은 받지 않으며 `users.consented_at` 은 NULL 로 남는다.

상태 변경 요청(signup·login·logout)은 `X-Requested-With: XMLHttpRequest` 헤더가 없으면 403(CSRF). 생성 SDK 가 POST 에 자동 부착한다.

**제한 베타 게이트 (Phase 3 F, 2026-09-19):** 서버 env `HOONDOK_INVITE_CODE`(SecretStr) 가 설정돼 있으면 `invite_code`(선택 필드, 1~64자, 앞뒤 공백 무시) 가 그 값과 일치해야 한다. 누락·불일치는 **403** `{ error_code: "INVITE_REQUIRED", message, request_id }` 이며 **중복 이메일 검사(409)보다 먼저** 판정해 초대받지 않은 요청에 이메일 존재 여부를 알리지 않는다. 비교는 바이트 상수 시간(`secrets.compare_digest`). 미설정·빈 값(`HOONDOK_INVITE_CODE=`)이면 `invite_code` 는 무시되고 기존 동작이다(로컬·E2E·pytest 는 autouse 픽스처로 OFF 고정). 로그인·로그아웃·me·기존 계정은 무관하다. 운영 값은 VM `.env` 에만 두고 `deploy-backend` 전에 넣는다.

## API-HD-003 `POST /hoondok/auth/login` · `logout` · `GET /hoondok/auth/me` (Phase 2)

- login: `{ email, password }` → 200 `{ user }` + 쿠키. 401 자격 불일치(이메일 존재 여부·소프트 삭제 여부를 구분하지 않는다).
- logout: 204 + 쿠키 만료. 만료·무효 토큰으로도 로그아웃할 수 있게 인증을 요구하지 않는다.
- me: 200 `{ user }`, 401 미인증(쿠키 없음·무효·`aud≠hoondok`·미존재·삭제 계정). 웹 `features/identity/` 게이트가 401 을 받으면 `/hoondok/onboarding?returnTo=` 로 보낸다.
- 토큰: JWT `aud="hoondok"`, 서명 키는 `ADMIN_JWT_SECRET` 공유. `admin_token`(aud 없음)은 훈독 디코더가 aud 를 명시 검사해 거부하고, 훈독 토큰은 admin 디코더가 `Invalid audience` 로 거부한다.

## API-HD-004 `GET /hoondok/me/summary` (Phase 2)

200 `{ today: { read, pray, study }, streak_days, best_streak_days, total_days, week: [{ date, done }] × 7 }`. 401 미인증.

- `today.*` 는 오늘(KST) 종류별 완료 여부. `streak_days`·`best_streak_days`·`total_days`·`week[].done` 은 **`read`(훈독하기) 완료 기준**(계획 §10, 2026-09-16)이며 `mission_logs` 에서 매번 계산하고 저장하지 않는다(`hoondok/streak.py`).
- `streak_days`: 오늘 완료면 오늘부터, 아니면 어제부터 거슬러 센다(오늘 아직 안 읽었다고 연속이 끊기지 않는다). 어제도 비었으면 0.
- `week`: 월요일 시작 7칸, 홈 요일 스트립과 같은 순서.

## API-HD-005 `POST /hoondok/missions/{kind}/complete` (Phase 2)

`kind ∈ {read, pray, study}`(경로 파라미터 Literal). 201 `{ mission_date, kind, completed_at }`. 409 같은 날 같은 kind 재요청(unique 제약, 본문 `"오늘은 이미 완료했어요"`). 401 미인증(`admin_token` 만 있는 브라우저도 401, 회귀 테스트). 422 알 수 없는 kind. 403 `X-Requested-With` 헤더 없음.

날짜 파라미터가 없고 서버가 `today_kst()` 로 `mission_date` 를 정하므로, 비로그인 체크의 소급 기록(AC-016-02)은 구조상 **당일만** 가능하다.

---

## API-HD-006 `GET /admin/hoondok/daily-readings` · `GET /admin/hoondok/daily-readings/{id}` (Phase 3)

편성 목록·단건. 비개발자 편성자가 `apps/admin` 편성 화면(sub-PR B)에서 쓴다(결정 2026-09-19).

```
GET /admin/hoondok/daily-readings?from=2026-09-19&to=2026-10-03
```

| 파라미터 | 기본 | 규칙 |
|---|---|---|
| `from` | 서버 KST 오늘 | 시작일(포함) |
| `to` | `from` + 14일 | 종료일(포함). `to < from` 또는 366일 초과 → 422 |

응답 200: `DailyReadingAdminResponse[]` 날짜 오름차순. 편성 없는 날은 행이 없다(빈 날 표시는 화면이 한다). 관리자 응답은 공개 스키마와 달리 `source_note`·`chunk_id`·`created_at`·`updated_at` 을 포함한다. 단건은 404 `"편성을 찾을 수 없습니다"`.

## API-HD-007 `POST /admin/hoondok/daily-readings` (Phase 3)

본문 `DailyReadingAdminCreate` = `ENT-HD-002` 전 컬럼(id·타임스탬프 제외). `title`·`body`·`speaker`·`work_title` 은 1자 이상, `authority_grade ∈ {O1..O5, R}`, `review_status ∈ {reviewed, unverified, withdrawn}`(기본 `unverified`), `estimated_minutes` 1~60(기본 3). 201 `DailyReadingAdminResponse`. 409 같은 `reading_date`(`"그 날짜에는 이미 편성이 있어요"`) · 422 검증 · 401 쿠키 없음 · 403 게이트 계정 아님 또는 `X-Requested-With` 없음. 감사 로그 `daily_reading.create`.

## API-HD-008 `PUT /admin/hoondok/daily-readings/{id}` (Phase 3)

본문 `DailyReadingAdminUpdate` — 모든 필드 선택, **보낸 필드만** 바꾼다(`exclude_unset`). `updated_at` 은 서버가 갱신한다. **DELETE 는 없다**: 철회는 `review_status=withdrawn` 이며 그날 `GET /hoondok/today` 는 `status=withdrawn`(본문 미노출)이 된다. 404 없음 · 409 `reading_date` 변경이 다른 편성과 충돌 · 422 · 401 · 403(게이트·CSRF). 감사 로그 `daily_reading.update`(변경 필드만).

---

## API-HD-009 `GET · POST · DELETE /hoondok/me/jeongseong` (W0-B)

정성 기간(7·21·40일) — 사용자당 진행 중(`active`) 1건. 진행률은 저장하지 않고 `mission_logs` 의 `read` 완료일에서 매번 계산한다(`hoondok/jeongseong.py`, [ENT-HD-004](../domain/hoondok-entities.md)). 인증 `hoondok_token`, POST·DELETE 는 `X-Requested-With: XMLHttpRequest` 없으면 403.

### GET — 진행 중인 기간 + 진행률

```
GET /hoondok/me/jeongseong
```

응답 200 `{ period: JeongseongPeriodResponse | null }`.

```json
{
  "period": {
    "id": "6f1c…",
    "topic": "감사",
    "duration_days": 21,
    "started_on": "2026-09-19",
    "reminder_time": "06:00:00",
    "status": "active",
    "progress": {
      "end_on": "2026-10-09",
      "done_days": 1,
      "missed_days": 0,
      "remaining_days": 20,
      "percent": 5,
      "state": "active"
    }
  }
}
```

| 필드 | 설명 |
|---|---|
| `status` | DB 저장 상태 `active` (응답에 나오는 기간은 항상 active) |
| `progress.end_on` | `started_on + (duration_days - 1)`, 양끝 포함 |
| `progress.state` | 오늘(KST) 기준 `upcoming`(시작 전) · `active` · `completed`(계산값, 저장 안 함) |
| `progress.done_days` | `[started_on, min(today, end_on)]` 중 `read` 완료일 수 |
| `progress.missed_days` | `[started_on, min(today-1, end_on)]` 중 미완료일 수 — **오늘은 밀린 날이 아니다** |
| `progress.remaining_days` | `max(end_on - today, 0)` |
| `progress.percent` | `done_days / duration_days × 100` 정수 반올림(half-up) |

`active` 인데 `end_on < today` 면 이 요청이 `status=completed` · `ended_at` 을 기록하고 `period: null` 을 돌려준다(별도 배치 없음). 진행 중인 기간이 없으면 `period: null`. 401 미인증.

### POST — 시작

본문 `JeongseongCreate`:

| 필드 | 규칙 |
|---|---|
| `topic` | 1~40자, 앞뒤 공백 제거 후 검사 |
| `duration_days` | `7` \| `21` \| `40` |
| `started_on` | 선택. 생략 시 오늘(KST). **오늘 ~ 오늘+30** 밖이면 422 |
| `reminder_time` | 선택 `HH:MM[:SS]`. 표시용 — 푸시는 Phase 4 |

201 `JeongseongPeriodResponse`(위 `period` 와 같은 형태). 409 이미 진행 중(`"이미 진행 중인 정성 기간이 있어요"`, 선조회 + 부분 unique IntegrityError 폴백) · 422 검증 · 403 CSRF · 401 미인증. 끝난 기간이 남아 있으면 GET 과 같이 `completed` 로 정리한 뒤 새로 만든다.

### DELETE — 그만두기

204, 진행 중인 기간을 `status=abandoned` · `ended_at` 으로 바꾼다(행은 남는다). 404 진행 중인 기간 없음(끝난 기간은 `completed` 로 정리되므로 404) · 403 CSRF · 401 미인증.

## API-HD-010 `GET /hoondok/me/history?month=YYYY-MM` (W0-B)

한 달의 날마다 `read` 완료 여부. 나의 정원 월 캘린더용.

```
GET /hoondok/me/history?month=2026-09
```

| 파라미터 | 기본 | 규칙 |
|---|---|---|
| `month` | 오늘(KST)의 월 | `^\d{4}-(0[1-9]\|1[0-2])$`. 형식 위반 422, 연도 `2020` ~ 올해+1 밖 422 |

응답 200 `{ month: "2026-09", days: [{ date, done }] × 그 달의 일수 }`(`calendar.monthrange`, 윤년 반영). `done` 은 `mission_logs.kind = read` 기준이며 미래 날은 항상 `false`. `days[].date`·`done` 은 API-HD-004 `week[]` 와 같은 `WeekDay` 스키마다. 401 미인증.

## API-HD-011 `DELETE /hoondok/auth/me` (W0-B)

"내 데이터 삭제 — 기록을 모두 지워요". 인증 `hoondok_token` + `X-Requested-With`.

```
DELETE /hoondok/auth/me
```

204 + `Set-Cookie: hoondok_token=; Max-Age=0`. 서버는 한 트랜잭션으로:

1. 본인 `mission_logs` · `jeongseong_periods` **하드 삭제**
2. `users.deleted_at = now`, `users.email = "deleted:{id}"` 로 익명화 — 같은 주소로 다시 가입할 수 있다(unique 인덱스 충돌 없음). `password_hash`·`display_name` 은 그대로 둔다

이후 `GET /hoondok/auth/me` 는 401(`get_optional_user` 가 `deleted_at` 사용자를 거른다), 이미 발급된 토큰도 같은 이유로 무효다. 로그인은 익명화된 이메일로 찾을 수 없어 401. 401 미인증 · 403 CSRF. 물리 삭제 주기(`[가정: 30일]`)는 비범위.

레이어: identity 는 hoondok 을 import 하지 않는다. `IdentityService.delete_account(user, purgers)` 가 `UserDataPurger` Protocol(`delete_for_user`) 목록을 받고, `identity/dependencies.py get_user_data_purgers` 가 `MissionLogRepository`·`JeongseongRepository` 를 같은 세션으로 주입한다. purger 는 커밋하지 않고 `UserRepository.save` 의 커밋에 묶인다.

---

## 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 5 API 로 축소. `today` 는 항상 200 + `status` 로 부재를 표현 | 확정 · 계획 §1-8 |
| 2026-09-16 | 훈독 인증 쿠키 `hoondok_token`, `aud="hoondok"`. `admin_token` 미사용 | 확정 · 계획 §1-4 |
| 2026-09-16 | API-HD-002·003 확정: `consent_version` 미수집, 만료 7일, CSRF 헤더, logout 무인증, 401 문구 단일 | 확정 · Phase 2 sub-PR A |
| 2026-09-16 | API-HD-004·005 확정: 연속일·week 는 `read` 기준, 오늘 미완료 시 어제부터 집계, 소급은 당일만 | 확정 · Phase 2 sub-PR B |
| 2026-09-19 | API-HD-006~008 신설(편성 admin). 관리자 블록·CSRF, DELETE 없음(철회 = `withdrawn`), 기본 범위 오늘~+14일, `seed_daily_readings.py` 는 로컬·E2E 한정 | 확정 · Phase 3 sub-PR A |
| 2026-09-19 | API-HD-002 제한 베타 게이트: `invite_code` 선택 필드 + `HOONDOK_INVITE_CODE` 설정 시 403 `INVITE_REQUIRED`(ErrorResponse, 409 보다 먼저), 미설정이면 무시. 계약은 선택 필드 추가만(하위 호환) | 확정 · Phase 3 sub-PR F |
| 2026-09-19 | API-HD-009~011 신설: 정성 기간(사용자당 active 1건·진행률 계산·끝난 기간은 읽는 시점에 completed·DELETE 는 abandoned), 월 기록(`month` 패턴·2020~올해+1), 계정 삭제(훈독 기록 하드 삭제 + `deleted_at` + 이메일 익명화·재가입 허용). `percent` 는 half-up 반올림 | 확정 · PLAN-HD-002 W0-B |
