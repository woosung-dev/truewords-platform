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
| `API-HD-012` | GET | `/admin/hoondok/daily-readings/candidates` | `admin_token` + `require_admin_gate` | HD-003 |
| `API-HD-019` | GET | `/hoondok/push/config` | 없음(공개) | HD-006 |
| `API-HD-020` | GET · PUT | `/hoondok/me/notifications` | `hoondok_token` (PUT 은 `X-Requested-With`) | HD-006 |
| `API-HD-021` | POST | `/hoondok/me/push` | `hoondok_token` + `X-Requested-With` | HD-006 |
| `API-HD-022` | DELETE | `/hoondok/me/push?endpoint=` | `hoondok_token` + `X-Requested-With` | HD-006 |
| `API-HD-023` | GET | `/hoondok/library/{series}` | 없음(공개) | HD-007 |
| `API-HD-024` | GET | `/hoondok/sections/{volume}` | 없음(공개) | HD-007 |
| `API-HD-025` | GET · PUT | `/hoondok/me/reading-positions` · `/hoondok/me/reading-position/{volume}` | `hoondok_token` (PUT 은 `X-Requested-With`) | HD-007 |
| `API-HD-026` | GET · PUT · DELETE | `/hoondok/me/marks` | `hoondok_token` (쓰기는 `X-Requested-With`) | HD-007 |
| `API-HD-027` | POST | `/admin/hoondok/content-rights/bulk` | `admin_token` + 게이트 + `X-Requested-With` | HD-007 |
| `API-HD-028` | GET | `/admin/hoondok/content-rights/series` | `admin_token` + `require_admin_gate` | HD-007 |
| `API-HD-029` | GET | `/hoondok/today/together` | 없음(공개) | HD-009 |
| `API-HD-030` | GET | `/hoondok/me/groups` | `hoondok_token` | HD-010 |
| `API-HD-031` | POST | `/hoondok/groups` | `hoondok_token` + `X-Requested-With` | HD-010 |
| `API-HD-032` | GET | `/hoondok/groups/{group_id}` | `hoondok_token` (모임원) | HD-010 |
| `API-HD-033` | PATCH · DELETE | `/hoondok/groups/{group_id}` | `hoondok_token` (리더) + `X-Requested-With` | HD-010 |
| `API-HD-034` | POST | `/hoondok/groups/{group_id}/invite` | `hoondok_token` (리더) + `X-Requested-With` | HD-010 |
| `API-HD-035` | GET | `/hoondok/invites/{code}` | `hoondok_token` + 초대 limiter | HD-010 |
| `API-HD-036` | POST | `/hoondok/invites/{code}/join` | `hoondok_token` + `X-Requested-With` + 초대 limiter | HD-010 |
| `API-HD-037` | PATCH · DELETE | `/hoondok/groups/{group_id}/me` | `hoondok_token` (모임원) + `X-Requested-With` | HD-010 |
| `API-HD-038` | GET · DELETE | `/hoondok/groups/{group_id}/members` · `/hoondok/groups/{group_id}/members/{member_id}` | `hoondok_token` (리더), DELETE 는 `X-Requested-With` | HD-010 |
| `API-HD-039` | POST · DELETE | `/hoondok/groups/{group_id}/jeongseongs` · `/hoondok/groups/{group_id}/jeongseongs/{jeongseong_id}` | `hoondok_token` (리더) + `X-Requested-With` | HD-010 |
| `API-HD-040` | PUT · DELETE | `/hoondok/groups/{group_id}/shares/today` · `/hoondok/groups/{group_id}/shares/{share_id}` | `hoondok_token` (모임원) + `X-Requested-With` | HD-010 |
| `API-HD-041` | PUT · DELETE | `/hoondok/groups/{group_id}/shares/{share_id}/reaction` | `hoondok_token` (모임원) + `X-Requested-With` | HD-010 |
| `API-HD-042` | GET · POST · PUT · DELETE | `/admin/hoondok/jeongseongs` · `/admin/hoondok/jeongseongs/{jeongseong_id}` | `admin_token` + 게이트 (쓰기는 `X-Requested-With`) | HD-010 |
| `API-HD-043` | GET · DELETE | `/admin/hoondok/groups` · `/admin/hoondok/groups/{group_id}` | `admin_token` + 게이트 (DELETE 는 `X-Requested-With`) | HD-010 |

공통 규칙:

- 라우터 prefix `/hoondok`, tag `hoondok`. `apps/api/app/main.py` 의 **공개 라우터 블록**에 등록한다(`require_admin_gate` 미적용).
- 인증 쿠키는 `hoondok_token`(HttpOnly, `COOKIE_SECURE` 준수). `admin_token` 은 어떤 훈독 엔드포인트에서도 읽지 않는다.
- 날짜(`date`)는 `YYYY-MM-DD`, 서버가 KST 로 계산한다. 클라이언트가 날짜를 보내는 파라미터는 없다.
- 오류 본문은 기존 FastAPI 규약(`{"detail": ...}`)을 따른다. 예외: API-HD-002 의 403 `INVITE_REQUIRED` 는 중앙 핸들러의 `ErrorResponse{ error_code, message, request_id }` 형식이다(SEC-MONO-001 의 `SESSION_FORBIDDEN` 과 같다) — 웹이 CSRF 403 과 `error_code` 로 구분한다.
- Phase 2 항목은 2026-09-16 sub-PR A(002·003)·B(004·005)에서 확정했다.
- `API-HD-006~008`·`API-HD-012~013`은 예외로 **관리자 블록**이다: prefix `/admin/hoondok/daily-readings`, tag `admin-hoondok`, `main.py` 에 `_ADMIN_GATE` 로 등록, 라우터 레벨 `verify_csrf`. 훈독 사용자 쿠키(`hoondok_token`)로는 호출할 수 없다. 2026-09-19 Phase 3 sub-PR A 에서 확정.
- `API-HD-019~022` 는 PLAN-HD-006(Web Push)이며 라우터는 `apps/api/app/modules/hoondok/notifications_router.py` 다. `API-HD-021` 의 409 `PUSH_DISABLED` 도 `ErrorResponse` 형식이다.
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

## API-HD-012 `GET /admin/hoondok/daily-readings/candidates` (PLAN-HD-003)

편성 후보 검색. **추출형(extractive)** 이다 — 말씀 코퍼스에서 원문 청크를 찾아 그대로 돌려주며 **생성 LLM 을 부르지 않는다.** 편성자가 417,579 청크를 훑는 대신 10~20건만 보고 고르게 하는 것이 이 API 의 전부이고, 무엇을 편성할지는 사람이 정한다(결정 5 "대체 생성 없음" 유지).

```
GET /admin/hoondok/daily-readings/candidates?q=참사랑&sources=B&sources=O&limit=12
```

| 파라미터 | 기본 | 규칙 |
|---|---|---|
| `q` | (필수) | 주제·키워드 1~200자. 공백만이면 422 |
| `sources` | 전체 | 코퍼스 카테고리 키 반복 지정(`L`·`M`·`N`·`O`·`B`·`P`·`Q`) |
| `min_len`·`max_len` | 50·300 | 본문 글자 수 범위(1~2000). `min > max` → 422 |
| `limit` | 12 | 1~30 |

응답 200 `DailyReadingCandidateResponse` — `query` + `candidates[]`. 후보가 없어도 200·빈 배열이다(검색 실패와 구분된다).

| 후보 필드 | 내용 |
|---|---|
| `chunk_id` | Qdrant point id. `ENT-HD-002` 의 `chunk_id` 에 그대로 들어가 원문 역추적을 잇는다 |
| `text` | **코퍼스 원문 그대로.** 서버가 다듬지 않는다 |
| `char_count`·`score` | 길이와 RRF 점수(편성자 판단용) |
| `source`·`source_label` | 카테고리 키와 읽기 쉬운 이름 |
| `work_title` | 권 이름(파일 확장자 제거) |
| `suggested_title`·`suggested_speaker` | **제안값.** 첫 문장 60자 · 출처 라벨 기반이며 편성자가 폼에서 고친다 |

검색은 기존 `hybrid_search`(dense+sparse RRF)를 재사용한다. 돌아온 결과에서 길이 범위를 벗어나거나, 문장이 끊겼거나(한국어 종결어미 없음), 페이지 인용 조각·파일명이 섞였거나, `chunk_id` 가 없는 것을 버린다 — 판정은 `hoondok/candidates.py`.

화면이 후보를 고르면 등급은 `R`(권리 확인 중)·검수는 `unverified` 로 채워진다. 코퍼스에서 뽑았다는 사실이 출처·권리 확인을 뜻하지 않기 때문이며, web 카드는 이 상태를 "확인되지 않음" 배지로 보여 준다.

오류: 422 검색어 없음·길이 역전 · 401 쿠키 없음 · 403 게이트 계정 아님 · **502 검색 실패**(Qdrant·임베딩 장애를 500 대신 이유 있는 응답으로 낸다). 조회이므로 감사 로그를 남기지 않는다(API-HD-006 과 같다).

> **라우트 순서**: `/candidates` 는 `/{reading_id}` 보다 **먼저** 등록해야 한다. FastAPI 는 등록 순서로 매칭하므로 뒤에 두면 "candidates" 가 UUID 로 파싱돼 422 가 난다. `tests/test_hoondok_candidates.py` 가 고정한다.

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

레이어: identity **service** 는 hoondok 을 import 하지 않는다(의존 주입은 `identity/dependencies.py` 의 `get_user_data_purgers` 한 곳). `IdentityService.delete_account(user, purgers)` 가 `UserDataPurger` Protocol(`delete_for_user`) 목록을 받고, `identity/dependencies.py get_user_data_purgers` 가 `MissionLogRepository`·`JeongseongRepository` 를 같은 세션으로 주입한다. purger 는 커밋하지 않고 `UserRepository.save` 의 커밋에 묶인다.

---

## 훈독 AI 질문 — 신규 엔드포인트 없이 `POST /chat/stream` 재사용 (W2)

AI 질문 화면(`SCR-PWA-005`·`006`)은 훈독 전용 엔드포인트를 만들지 않는다. 시연 챗과 **같은** `POST /chat/stream` SSE 를 그대로 호출하며 요청·응답 스키마, 프롬프트, RAG 정책, 서버 기록 모두 시연 챗과 같다. 백엔드는 이 웨이브에서 한 줄도 바뀌지 않았다.

- 호출부는 `apps/web/src/features/hoondok/ask/ask-stream.ts` 하나다. 경로(같은 origin 프록시 `/api/backend/chat/stream`)·`X-Requested-With: XMLHttpRequest`·쿠키 동봉은 시연 챗(`features/chatbot/chat-api.ts`)과 동일하다.
- 본문은 `{ query, chatbot_id }` 뿐이다. `chatbot_id` 는 UUID 가 아니라 슬러그이며 `HOONDOK_ASK_CHATBOT_ID = "all"` 상수 하나가 정한다. `[확인 필요]` 훈독 전용 봇이 정해지면 이 상수만 바꾼다.
- **시연 챗과 다른 점은 둘뿐이고 둘 다 클라이언트 쪽이다.**
  1. **무기억** — `session_id`(과 `answer_mode`)를 보내지 않는다. `session_id` 는 원래 선택 필드라 서버는 매 질문마다 새 세션을 만든다(`chat/pipeline/stages/session.py`). 이어 묻기도 새 요청이다.
  2. **근거 게이트** — `chunk` 텍스트를 화면에 바로 흘리지 않고 모아 두었다가 `sources` 이벤트가 **1건 이상일 때만** 답을 보인다(AC-017-01·04). 0건은 오류가 아니라 성공 경로이며 "확인할 수 없음" 으로 끝난다. 서버는 이 게이트를 알지 못한다.
- 질문·답·근거는 **서버에 따로 저장하지 않는다.** 브라우저 `localStorage` 한 키 `hoondok:ask:items`(JSON 배열, 최대 50건)에만 둔다(`ask/storage.ts`, `REQ-PWA-015`). 서버에는 시연 챗과 똑같은 `/chat/stream` 요청 기록이 남는다.
- `sources` 항목은 표시명(`display_name`)·권(`volume`)·본문만 주고 화자·판본·권위 등급은 주지 않는다. 화면은 없는 항목을 지어내지 않는다(AC-017-02).

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
| 2026-09-19 | 훈독 AI 질문은 **신규 엔드포인트 없이** `POST /chat/stream` 재사용. 백엔드·스키마 무변경이며 무기억(`session_id` 미전송)과 근거 게이트만 클라이언트에 둔다 | 확정 · PLAN-HD-002 W2 |
| 2026-09-19 | 질문 봇은 슬러그 `all` 고정(`HOONDOK_ASK_CHATBOT_ID`). 전용 봇·프롬프트 미정이라 상수 1줄로 교체 가능한 형태로 둔다 | `[확인 필요]` · PLAN-HD-002 W2 |
| 2026-09-20 | API-HD-012 신설(편성 후보 검색). **추출형 채택 · 생성형 초안 기각** — 병목은 본문 생산이 아니라 코퍼스에서 고르는 일이고, 생성형은 결정 5(대체 생성 없음)를 뒤집는 데다 교리 recall 이 42~56%로 낮다. 본문 원문 유지·`chunk_id` 기록·등급 `R` 기본 | 확정 · PLAN-HD-003 |
| 2026-09-23 | API-HD-023~028 신설(말씀 서고 3계층·읽기 기록). 목차 경로는 `/hoondok/sections/{volume}` — `/hoondok/words/{volume:path}` 가 greedy 라 하위 경로를 쓸 수 없다. `API-HD-014` 에 `works[]`, `API-HD-016` 에 `section` 파라미터·필드, `content_rights` 에 `chunk_count` 를 **추가만** 했다(하위 호환). 기록은 로그인 필수, 읽기는 공개 | 확정 · PLAN-HD-007 트랙 A |
| 2026-09-23 | API-HD-015·016 항목에 `display_text` 추가(하위 호환). 원본 `text` 는 유지하고 표시할 때만 정리한다 — Qdrant 재적재·재임베딩 없음 | 확정 · PLAN-HD-008 트랙 A |
| 2026-09-22 | API-HD-019~022 신설(Web Push). VAPID 미설정이면 구독 자체를 409 `PUSH_DISABLED` 로 거절(조용히 저장하지 않음), `endpoint` unique + 소유 이전, `read_time` 은 `HH:MM` 문자열·KST 고정, 설정 PUT 은 전체 교체. 발송기는 sub-PR B | 확정 · PLAN-HD-006 sub-PR A |

---

## PLAN-HD-006 — 알림 설정과 Web Push 구독 (API-HD-019~022)

발송은 별도 스크립트(sub-PR B)가 맡는다. 여기서는 **구독 보관과 설정**만 정의한다.

서버 VAPID 3값(`HOONDOK_VAPID_PUBLIC_KEY`·`HOONDOK_VAPID_PRIVATE_KEY`·`HOONDOK_VAPID_SUBJECT`)이
모두 설정되어야 기능이 열린다. 하나라도 비면 `API-HD-019` 가 `enabled=false` 를 내고
`API-HD-021` 은 409 `PUSH_DISABLED` 로 거절한다 — 보낼 수 없는 구독을 조용히 쌓아 두지 않는다.

### `API-HD-019 GET /hoondok/push/config` (공개)

`{"enabled": bool, "public_key": string|null}`. 비밀 키·subject 는 어떤 응답에도 넣지 않는다.

### `API-HD-020 GET · PUT /hoondok/me/notifications`

`{"read_enabled": bool, "read_time": "HH:MM", "lock_screen_level": "neutral"|"faith", "subscription_count": int}`.

- 저장된 행이 없으면 GET 은 기본값(`false` · `"06:00"` · `"neutral"`)을 돌려주고 행을 만들지 않는다.
- PUT 은 **전체 교체** upsert 다. 생략한 필드는 기본값으로 되돌아간다(부분 수정 아님).
- `read_time` 은 항상 `HH:MM` 문자열이다. `"6:00"`·`"25:00"`·`"06:00:00"` 은 422. 발송 기준 시간대는 KST 고정이라 오프셋을 받지 않는다.
- `subscription_count` 는 본인 구독 수다 — 웹이 "알림 켬 + 기기 0대" 상태를 안내하는 데 쓴다.

### `API-HD-021 POST /hoondok/me/push`

요청 `{"endpoint": str(1..2048), "keys": {"p256dh": str, "auth": str}, "user_agent": str|null}`,
응답 201 `{"id", "endpoint", "created_at"}`.

`endpoint` 는 브라우저가 발급한 전역 식별자라 unique 다. 같은 endpoint 를 다시 보내면 행이 늘지 않고
키·`user_agent` 가 갱신되며 `failed_count` 가 0으로 돌아간다. 다른 계정이 같은 기기를 구독하면
소유(`user_id`)가 옮겨간다 — 한 기기의 알림이 이전 사용자에게 가지 않게 하려는 것이다.
`user_agent` 는 장애 분류용이며 200자로 잘라 저장한다(400자 초과 요청은 422).

### `API-HD-022 DELETE /hoondok/me/push?endpoint=`

본인 구독만 지우고 없어도 204 다(멱등). 남의 endpoint 를 넣어도 204 지만 그 행은 남는다 —
존재 여부를 알려주지 않기 위해서다.

`POST /hoondok/client-errors`(API-HD-018)의 `kind` 에 `push_subscribe`(알림 구독 실패)를 추가했다.

---

## PLAN-HD-005 — 권리·말씀·정성·오류 수집

`API-HD-014~017`의 본문 조회는 신규 기능의 권리 게이트를 적용한다. 기존 AI 답변·전체 오늘 편성의 전면 권리 전환은 이 변경에 포함하지 않는다.

| ID | Method · Path | 인증 | 동작 |
|---|---|---|---|
| `API-HD-013` | GET·POST `/admin/hoondok/content-rights`, PUT `/admin/hoondok/content-rights/{id}` | admin + 게이트 + 변경 시 CSRF | 저작물 권리 목록·등록·수정. 삭제 대신 withdrawn |
| `API-HD-014` | GET `/hoondok/library` | 공개 | allowed AND (scope_search OR scope_full_text) 저작물 목록. 정성 전용은 제외, 빈 목록은 200 |
| `API-HD-015` | GET `/hoondok/search?q=&limit=` | 공개 | 검색 허용 volume을 Qdrant dense/sparse 양쪽에 적용. 빈 허용 목록은 검색 없이 빈 결과 |
| `API-HD-016` | GET `/hoondok/words/{volume}?page=&chunk_id=` | 공개 | full_text 허용 저작물의 20청크 구간. chunk_id는 해당 구간 직접 이동 |
| `API-HD-017` | GET `/hoondok/me/jeongseong/today` | hoondok_token | 오늘 정성 추출 말씀을 lazy 생성·저장·재사용 |
| `API-HD-018` | POST `/hoondok/client-errors` | 익명 허용 | 안전한 오류 종류·경로만 수집, IP당 20회/분 제한 |

### 응답과 접근 경계

- 서고는 `{items}`이며 항목에 `volume`, `work_title`, 권위·출처 정보, `scope_search`, `scope_full_text`를 제공한다.
- 검색은 `{results}`이며 항목에 `chunk_id`, `chunk_index`, `text`, `volume`, `score`, `can_read_full_text`를 제공한다. 검색어 원문은 저장하지 않는다. 0건은 200, 검색 장애는 공통 `SEARCH_FAILED` **503**이다.
- 원문은 `volume`, `work_title`, `page`, `page_size=20`, `total_chunks`, `total_pages`, `chunks`, `body`를 제공한다. `chunk_index` 범위로 조회 후 정렬한다. 미허용·다른 volume의 chunk_id·삭제된 청크는 404이다. 실제 장·절 메타데이터를 만들지 않는다.
- 정성은 `date`, `status`, `reason`, `period_id`, `reading`을 제공한다. `reason`은 `no_period`, `upcoming`, `no_candidates`, `rights_withdrawn` 또는 null이다. `reading`은 `DailyReadingPublic`과 같다. `scope_jeongseong`은 검색·원문 권한과 독립적이다. 저장 후에도 매 조회 현재 권리를 확인한다.
- 정성 후보 없음·오류는 웹에서 이유와 함께 일반 편성을 사용한다. 7·21·40일 종료일과 기존 `read` 완료 진도는 유지한다. 완료 후 같은 날 조회해도 같은 말씀이다. 추출은 검수 완료가 아니며 생성 LLM을 사용하지 않는다.

오류 수집 요청은 `{kind,path}`이며 성공은 204다. 익명도 CSRF 헤더가 필요하며 전용 IP당 20회/분 제한을 적용한다. 원본 예외 메시지·질문·검색어·토큰·URL 쿼리를 보내거나 저장하지 않는다. 종류에 대응하는 안전한 문구와 정규화된 경로만 저장하며 보고 실패는 재보고하지 않는다. 계정 삭제 시 정성 말씀과 사용자 연결 오류 기록도 삭제한다.


말씀 검색의 웹 경로 `/api/backend/hoondok/search`는 전용 Route Handler를 사용한다.
백엔드 `GET /hoondok/search` 계약은 유지한다. 연결 실패는 안전한 `SEARCH_FAILED` 503으로 바꾸며,
Next catch-all rewrite의 실패 로그에 검색어가 포함된 upstream URL이 출력되지 않도록 한다.


---

## PLAN-HD-007 — 말씀 서고 3계층과 읽기 기록 (API-HD-023~028)

저작물(`book_series`) → 권(`volume`) → 장(`volume_sections`) 3계층과 사용자 읽기 기록을 추가한다.
서고·목차 조회는 공개이고 기록(`/hoondok/me/*`)은 `hoondok_token` 이 필요하다(PLAN-HD-007 §2-6).
단락의 단위는 Qdrant 청크(`chunk_index`·`chunk_id`)이며 청크 안 부분 선택은 하지 않는다(§2-12).

### API-HD-014 확장 `GET /hoondok/library`

`items[]` 는 그대로 두고 `works[]` 를 더한다. 항목은
`{ series, title, volume_count, allowed_count, authority_grade, scope_search, scope_full_text }` 다.
`book_series` 로 묶으며 **허용(`allowed` AND (`scope_search` OR `scope_full_text`)) 권이 1건 이상인 시리즈만** 오른다.
`volume_count` 는 원장에 등록된 전체 권 수(`status` 무관), `allowed_count` 는 지금 열려 있는 권 수다.
`authority_grade` 는 허용 권의 최빈 등급이고 동률이면 가장 보수적인 `R` 이다. `scope_*` 는 허용 권의 OR 다.
`book_series` 가 비어 있는 행은 저작물로 묶을 수 없어 `works` 에서 빠진다(`items` 에는 남는다). 정렬은 제목순.

### API-HD-023 `GET /hoondok/library/{series}` (공개)

응답 `{ series, title, authority_grade, volumes[] }`, 항목은
`{ volume, label, total_chunks, section_count, scope_full_text }` 다.
`label` 은 말씀선집만 권 번호 3자리(`"001권"`)로 정규화하고 나머지는 원장의 `work_title` 이며,
정렬은 라벨의 숫자 우선이다(`001권` < `010권` < `100권`). `total_chunks` 는 `content_rights.chunk_count`
라 시드 전에는 `null` 이다. `section_count` 는 `volume_sections` 집계다.
미등록 시리즈이거나 허용 권이 0건이면 404 — 존재 여부를 알리지 않는다.

### API-HD-024 `GET /hoondok/sections/{volume}` (공개)

응답 `{ volume, sections[] }`, 항목은
`{ position, level, title, start_chunk_index, end_chunk_index, spoken_on, place }` 다.
권리 게이트는 `API-HD-016` 과 같다(`allowed` + `scope_full_text`, 아니면 404). 0건이면 빈 배열 200이고
웹은 "구간 N" 폴백을 쓴다. 경로가 `/hoondok/words/{volume}/sections` 가 **아닌** 이유는
`/hoondok/words/{volume:path}` 가 greedy 라 하위 경로를 volume 으로 삼키기 때문이다.
원문과 같은 IP당 120회/분 예산을 쓴다.

### API-HD-016 확장 `GET /hoondok/words/{volume}?section=`

`section`(= `position`, 1 이상)을 주고 `chunk_id` 를 주지 않으면
`start_chunk_index // 20 + 1` 페이지를 낸다. 없는 `position` 은 404다. `chunk_id` 가 우선한다 —
검색 결과 진입이 목차 선택보다 구체적이다. 응답에 `section`(`{ position, level, title }` 또는 `null`)이
더해진다. `section=` 으로 들어온 요청은 **요청한 그 장**을 그대로 돌려준다 — 장 시작이 페이지 경계와
어긋나도 앞 장을 현재 장으로 보이지 않는다. `chunk_id` 또는 `page` 만 준 요청은 **반환 페이지의 첫 청크를
품는 구간**이다(편과 장이 겹치면 더 좁은 `level` 2). 기존 필드는 그대로다.

### API-HD-015·016 확장 `display_text` (PLAN-HD-008)

`chunks[]`(016)와 `results[]`(015) 항목에 `display_text: string` 이 **추가만** 된다(하위 호환). `text` 는
Qdrant 원본 그대로이고 AI 설명·인용은 계속 `text` 를 쓴다. `display_text` 는 화면 표시용이다 — 앞 청크와
겹치는 머리(~150자) 제거(016만, 페이지 첫 청크와 015 는 앞이 없다), 페이지 번호 줄(`- 2 -`) 제거,
한 글자씩 띄운 제목(`머 리 말`) 붙이기, PDF 줄바꿈 합치기, 문단 경계는 `"\n\n"`.
규칙은 `app/modules/hoondok/display_text.py` 순수 함수가 소유하고 Qdrant 데이터·임베딩은 바꾸지 않는다.

### API-HD-025 이어 읽기 (`hoondok_token`)

- `GET /hoondok/me/reading-positions?limit=5&volume=` — 최신순. 항목은
  `{ volume, chunk_index, updated_at, work_title, series, label }`. `volume` 을 주면 그 권만 — 원문 화면의
  복귀 조회를 위해 단건 경로 대신 필터를 둔다. `limit` 은 1~50.
- `PUT /hoondok/me/reading-position/{volume}` body `{ chunk_index }` (0 이상, `X-Requested-With` 필요)
  — `(user_id, volume)` upsert, 200으로 갱신된 항목을 낸다. 원문이 허용되지 않은 권은 404.

서버 값이 있으면 서버가 우선이고 없으면 기기 값을 1회 올린다. 비로그인은 기기 값만 쓴다(PLAN-HD-007 §2-13).

### API-HD-026 단락 표시 (`hoondok_token`)

- `GET /hoondok/me/marks?volume=&kind=&limit=` — 최신순, 본인 것만. 항목은
  `{ chunk_id, chunk_index, volume, kind, color, note, updated_at, work_title, label }`.
  `limit` 은 1~200이고 기본 200이다 — 표시가 쌓여도 한 요청이 읽는 행 수를 묶어 둔다.
- `PUT /hoondok/me/marks/{chunk_id}` body `{ volume, chunk_index, kind, color, note }`
  — `(user_id, chunk_id, kind)` upsert. `kind` 는 `bookmark`·`highlight`. `highlight` 는 `color`(1~3)가
  없으면 422, `bookmark` 는 넘어온 `color` 를 버린다. `note` 는 2000자까지이며 노트 탭은 `note` 가 있는
  표시를 모은 것이다. 원문이 허용되지 않은 권은 404.
- `DELETE /hoondok/me/marks/{chunk_id}?kind=` — 204. 없는 표시도 204이며 남의 표시는 지워지지 않는다.

계정 하드 삭제(`API-HD-011`)는 `reading_positions`·`passage_marks` 를 함께 지운다.

### API-HD-027 `POST /admin/hoondok/content-rights/bulk`

body `{ book_series, status, scope_search, scope_full_text, scope_jeongseong, authority_grade? }`,
응답 `{ book_series, updated }`. 그 시리즈의 **모든** 행을 갱신하며 `authority_grade` 는 준 경우에만 바꾼다
(미지정이면 기존 등급 보존). 행이 0건이면 404. 감사 로그는 정확히 1건(`content_right.bulk`,
`target_table="content_rights"`)이고 `target_id` 는 시리즈 대표 행이며 실제 범위는 `changes` 의
`book_series`·`updated` 가 갖는다. 관리자 게이트 + `X-Requested-With` 가 필요하다.

### API-HD-028 `GET /admin/hoondok/content-rights/series`

응답 `{ items: [{ series, title, registered, allowed, pending, withdrawn, chunk_count }] }` — 원장에
있는 모든 시리즈(제목 미등록 키는 키 그대로). `chunk_count` 는 합이며 전부 미집계면 `null` 이라
0 과 구분된다. `book_series` 가 빈 행은 집계에서 빠진다. 조회라 감사 로그를 남기지 않는다.

### `content_rights.chunk_count`

권의 Qdrant 청크 수를 담는 nullable 열이다. 시드 스크립트(트랙 D)가 채우며 `API-HD-013` 의
입력 스키마에는 없어 admin 개별 저장이 값을 덮지 않는다. 조회 응답(`ContentRightResponse`)에는 나온다.

---

## API-HD-029 `GET /hoondok/today/together`

> 추가일: 2026-09-23 ([PLAN-HD-009](../../plans/active/2026-09-23-hoondok-together.md) 함께 읽는 사람들 1단계)

오늘(KST) 훈독하기(`kind="read"`, 연속일과 같은 kind)를 완료한 **서로 다른 사용자 수**. 익명 전체 집계만 내며
사람 정보(이름·ID·모임)는 없다. 인증이 필요 없고 항상 200 이다. 라우터는 `app/modules/hoondok/router.py`.

응답 `TogetherTodayResponse`:

```json
{ "date": "2026-09-23", "count": 1284, "is_shown": true, "threshold": 10 }
{ "date": "2026-09-23", "count": null, "is_shown": false, "threshold": 10 }
```

- 완료자가 `threshold`(`HOONDOK_TOGETHER_MIN_COUNT`, 기본 10) 미만이면 `count=null`, `is_shown=false` — 숫자 자체를 내려보내지 않는다.
- 집계는 `mission_logs` 의 `mission_date = 오늘(KST)` · `kind = read` 의 `COUNT(DISTINCT user_id)` 이고 `users.deleted_at` 이 있는 사용자는 뺀다. 인덱스 `ix_mission_logs_date_kind(mission_date, kind)`.
- 원시 수를 프로세스 메모리에 `HOONDOK_TOGETHER_CACHE_SECONDS`(기본 60초) 동안 둔다. 워커별 캐시라 워커 사이 값이 잠시 다를 수 있고, 방금 완료한 사용자가 아직 빠진 값일 수 있다. 0 이면 매 요청 집계한다.
- 이 숫자는 푸시 알림에 넣지 않는다.

---

## PLAN-HD-010 — 함께 읽는 모임 (API-HD-030~043)

> 추가일: 2026-09-23 ([PLAN-HD-010](../../plans/active/2026-09-23-hoondok-groups.md) 2단계). 라우터 `apps/api/app/modules/hoondok/groups_router.py`(030~041, 공개 블록), `groups_admin_router.py`(042·043, `_ADMIN_GATE`).
> 엔티티 [ENT-HD-013~017](../domain/hoondok-entities.md#ent-hd-013-reading_groups--소그룹-모임-plan-hd-010).

### 공통

- **비모임원에게는 모든 모임 라우트가 404 `GROUP_NOT_FOUND`** — 없는 모임과 구분하지 않는다. 모임원이 리더 전용 동작을 부르면 403 `LEADER_ONLY`.
- 오류는 `{"detail": "<코드>"}` 이다. 409 코드: `LEADER_LIMIT`(리더 3) · `JOIN_LIMIT`(속한 모임 5, 리더인 모임 포함 `[가정]`) · `GROUP_FULL`(정원 50) · `ALREADY_MEMBER` · `DISPLAY_NAME_TAKEN` · `JEONGSEONG_LIMIT`(진행 중·예정 모임 정성 3) · `READ_REQUIRED` · `LEADER_MUST_HANDOVER` · `CANNOT_REMOVE_SELF` · `OWN_SHARE`. 404: `GROUP_NOT_FOUND` · `INVITE_NOT_FOUND` · `MEMBER_NOT_FOUND` · `SHARE_NOT_FOUND` · `JEONGSEONG_NOT_FOUND`. 403: `LEADER_ONLY` · `NOT_ALLOWED`(남의 한 줄 삭제). 422: Pydantic 검증 + `STARTED_ON_OUT_OF_RANGE` · `JEONGSEONG_ALREADY_ENDED`.
- **개인정보 경계**: 모임원 응답에는 오늘(KST) `mission_logs kind='read'` 완료자만 담는다. 미완료자 목록·수·상태, 전체 인원(`member_count`), `user_id` 는 어떤 모임원 응답에도 없다. 전체 인원은 `API-HD-038`(리더)·`API-HD-043`(admin) 에만 있다.
- 완료자 `readers[]` 는 표시 이름 가나다순 `{display_name, read_at_kst, is_me, is_leader}`. `read_at_kst` 는 `completed_at`(UTC) 을 `+09:00` 로 바꾼 값.
- 표시 이름(≤12)·모임 이름(≤20)은 앞뒤 공백을 지운 뒤 검증한다 — 공백만이면 422, 앞뒤 공백만 다른 이름은 같은 이름(409). 한 줄(≤100)은 줄마다 앞뒤 공백 제거·연속 공백 1칸·빈 줄 제거 뒤 1~100자.
- 정성 `jeongseongs[]` `{id, title, started_on, duration_days, day_index, state, is_official, source_note}` — 공식(`group_id NULL`) + 이 모임 것, 끝난 것은 빠진다. `day_index = (오늘 - started_on) + 1`, 시작 전이면 `day_index=null`·`state=upcoming`. `source_note` 는 공식 정성의 출처(API-HD-042 관리자 입력 그대로, 미입력 null), 모임 정성은 항상 null. 030·032·035 가 같은 형태를 쓴다.

### API-HD-030 `GET /hoondok/me/groups`

`[{id, name, kind, role, my_display_name, today_read_count, readers_preview, jeongseongs}]`(정성 항목에 `source_note` 포함), 0건 `[]`. `today_read_count` 는 오늘 완료자 수, `readers_preview` 는 완료자 이름 첫 글자 최대 3개.

### API-HD-031 `POST /hoondok/groups`

`{name, display_name, meeting_time?, jeongseong?{title(≤24), duration_days(1~100), started_on(오늘±30)}}` → 201 `GroupDetail`(032 와 같은 형태, 리더라 `invite_code` 포함). 만든 사람이 리더다.

### API-HD-032 `GET /hoondok/groups/{group_id}`

`{id, name, kind, leader_display_name, meeting_time, date, today_reading, jeongseongs, readers, shares, me, invite_code, invite_expires_at}`.
`today_reading` 은 오늘 편성 요약 `{id, reading_date, title, speaker, work_title, chunk_id, estimated_minutes}`(본문 없음, 없거나 철회면 null). `jeongseongs[]` 항목에 `source_note` 가 있다. `shares[]` 는 오늘 것 중 오늘 완료자(`readers`)가 쓴 것만 `{id, display_name, body, created_at_kst, is_mine, has_my_reaction, reaction_count}` — `reaction_count` 는 내 한 줄에만 값, 남의 것은 null. 반응한 사람 목록은 누구에게도 주지 않는다. `me` `{member_id, display_name, role, has_read_today, has_shared_today}`. `invite_code`·`invite_expires_at` 은 리더만 값, 모임원은 null.

### API-HD-033 `PATCH · DELETE /hoondok/groups/{group_id}` (리더)

PATCH `{name}` → 200 `GroupDetail`. DELETE → 204, 모임 하드 삭제(`share_reactions → group_shares → shared_jeongseongs(모임) → group_members → reading_groups`).

### API-HD-034 `POST /hoondok/groups/{group_id}/invite` (리더)

→ 200 `{invite_code, invite_expires_at}`. 새 코드로 덮어써 이전 코드는 즉시 404, 만료는 발급 +30일.

### API-HD-035 `GET /hoondok/invites/{code}`

→ 200 `{name, kind, leader_display_name, jeongseongs, is_member, group_id}`(전체 인원 없음, 정성 항목에 `source_note` 포함). 코드는 대소문자·하이픈·공백을 무시하고 Crockford 별칭(I·L→1, O→0)을 적용해 정규화한다. 잘못·만료·정원 초과는 모두 같은 404 `INVITE_NOT_FOUND`. 이미 모임원이면 정원과 무관하게 `is_member=true` + `group_id`. 초대 limiter `RateLimiter(10, 60)` IP 기준(036·가입 게이트와 공유) — 초과 429 `RATE_LIMIT_EXCEEDED`(`ErrorResponse`).

### API-HD-036 `POST /hoondok/invites/{code}/join`

`{display_name}` → 201 `{group_id}`. 404 `INVITE_NOT_FOUND` · 409 `ALREADY_MEMBER`·`DISPLAY_NAME_TAKEN`·`GROUP_FULL`·`JOIN_LIMIT`. 사용자 행 → 모임 행 순으로 잠근 뒤(`SELECT ... FOR UPDATE`) 인원을 다시 세어 마지막 자리 경쟁에서도 정원을 넘지 않는다. 이름·중복 가입 경쟁은 unique 제약 IntegrityError → 409.

### API-HD-037 `PATCH · DELETE /hoondok/groups/{group_id}/me`

PATCH `{display_name}` → 200 `me`(409 `DISPLAY_NAME_TAKEN`). DELETE 나가기 → 204, 내 한 줄·내가 누른 반응·내 한 줄에 달린 반응·모임원 행을 지운다. 리더는 다른 식구가 있으면 409 `LEADER_MUST_HANDOVER`, 혼자면 모임을 지운다.

### API-HD-038 `GET /hoondok/groups/{group_id}/members` · `DELETE /.../members/{member_id}` (리더)

GET → `{member_count, items[{id, display_name, role, joined_at}]}`(들어온 순). 읽음 상태 필드는 없다. DELETE 내보내기 → 204, 037 탈퇴와 같은 삭제. 자기 자신 409 `CANNOT_REMOVE_SELF`, 없는 식구 404 `MEMBER_NOT_FOUND`.

### API-HD-039 `POST /hoondok/groups/{group_id}/jeongseongs` · `DELETE /.../jeongseongs/{jeongseong_id}` (리더)

POST `{title(≤24), duration_days(1~100), started_on(오늘±30)}` → 201 정성 항목. 이미 끝난 기간은 422 `JEONGSEONG_ALREADY_ENDED`, 진행 중·예정 모임 정성이 3개면 409 `JEONGSEONG_LIMIT`. 수정 API 는 없다. DELETE 는 이 모임 정성만 — 공식 정성·남의 모임 정성은 404.

### API-HD-040 `PUT /hoondok/groups/{group_id}/shares/today` · `DELETE /.../shares/{share_id}`

PUT `{body}` → 200 내 한 줄(1인 1일 1줄 upsert, 같은 id 유지). 오늘 `read` 미완료면 409 `READ_REQUIRED`. DELETE 는 작성자 또는 리더, 그 외 모임원 403 `NOT_ALLOWED`.

### API-HD-041 `PUT · DELETE /hoondok/groups/{group_id}/shares/{share_id}/reaction`

"함께 머물렀어요" 켜기·끄기 → `{has_reacted}`, 둘 다 멱등. 오늘 한 줄만(지난 한 줄 404), 자기 한 줄 409 `OWN_SHARE`. 알림 없음.

### API-HD-042 `/admin/hoondok/jeongseongs` (admin 게이트)

GET 목록(시작일 내림차순) · POST `{title(≤40), started_on, duration_days(1~100), source_note?(≤200)}` → 201 · PUT `/{id}` 전체 교체 · DELETE `/{id}` 204. 응답 `{id, title, started_on, duration_days, source_note, created_at, updated_at}`. 공식 정성(`group_id IS NULL`)만 다루며 모임 정성 id 는 404. 감사 로그 `official_jeongseong.create|update|delete`(`target_table=shared_jeongseongs`).

### API-HD-043 `/admin/hoondok/groups` (admin 게이트)

GET → `[{id, name, member_count, created_at}]`(최신순) — 모임원 이름·한 줄 본문·초대 코드는 admin 에게도 내지 않는다. DELETE `/{id}` → 204(033 과 같은 하드 삭제) + 감사 로그 `reading_group.delete`, 없는 모임 404.

### API-HD-002 변경 — 모임 초대 코드로 가입 (D4)

`HOONDOK_INVITE_CODE` 가 설정돼 있고 `invite_code` 가 전역 코드와 다르면, 모임 코드 형식일 때만 `InviteCodeVerifier` 에 한 번 더 묻는다. 존재·미만료·정원 미달이면 가입 201, 아니면 기존과 같은 403 `INVITE_REQUIRED`. 모임 코드 형식 검증 시 초대 limiter 를 함께 센다. 가입만 통과시키며 모임 참여는 `API-HD-036` 을 따로 부른다. 전역 코드 미설정이면 기존대로 `invite_code` 를 무시한다(verifier 도 부르지 않는다). identity service 는 hoondok 을 import 하지 않고 `identity/dependencies.py get_identity_service` 가 `GroupInviteVerifier` 를 주입한다.

### API-HD-011 변경 — 계정 삭제

`get_user_data_purgers` 에 `GroupRepository` 가 더해졌다. 모임마다 모임원 행·한 줄·반응을 지우고, 리더였다면 가장 먼저 들어온 식구(`joined_at` 오름차순)에게 리더를 넘긴다. 남은 식구가 없으면 모임을 지운다. 이 사용자가 만든 정성의 `created_by_user_id` 는 NULL 로 비운다.
