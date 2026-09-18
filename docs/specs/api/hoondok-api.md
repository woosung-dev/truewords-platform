# 훈독 API 명세 — `/hoondok/*`

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

공통 규칙:

- 라우터 prefix `/hoondok`, tag `hoondok`. `apps/api/app/main.py` 의 **공개 라우터 블록**에 등록한다(`require_admin_gate` 미적용).
- 인증 쿠키는 `hoondok_token`(HttpOnly, `COOKIE_SECURE` 준수). `admin_token` 은 어떤 훈독 엔드포인트에서도 읽지 않는다.
- 날짜(`date`)는 `YYYY-MM-DD`, 서버가 KST 로 계산한다. 클라이언트가 날짜를 보내는 파라미터는 없다.
- 오류 본문은 기존 FastAPI 규약(`{"detail": ...}`)을 따른다.
- Phase 2 항목은 2026-09-16 sub-PR A(002·003)·B(004·005)에서 확정했다.

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

요청 `{ email, password, display_name }` → 201 `{ user: { id, email, display_name } }` + `Set-Cookie: hoondok_token`(HttpOnly, `Path=/`, `Max-Age` = `HOONDOK_JWT_EXPIRE_MINUTES`×60, 기본 7일). 409 이메일 중복(대소문자 무시, 동시 가입 경쟁도 409), 422 검증 실패(이메일 형태 `로컬@도메인.tld`·비밀번호 8~128자·이름 1~64자). 약관 문구(`DEC-PWA-001` `[확인 필요]`) 확정 전이라 `consent_version` 은 받지 않으며 `users.consented_at` 은 NULL 로 남는다.

상태 변경 요청(signup·login·logout)은 `X-Requested-With: XMLHttpRequest` 헤더가 없으면 403(CSRF). 생성 SDK 가 POST 에 자동 부착한다.

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

## 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 5 API 로 축소. `today` 는 항상 200 + `status` 로 부재를 표현 | 확정 · 계획 §1-8 |
| 2026-09-16 | 훈독 인증 쿠키 `hoondok_token`, `aud="hoondok"`. `admin_token` 미사용 | 확정 · 계획 §1-4 |
| 2026-09-16 | API-HD-002·003 확정: `consent_version` 미수집, 만료 7일, CSRF 헤더, logout 무인증, 401 문구 단일 | 확정 · Phase 2 sub-PR A |
| 2026-09-16 | API-HD-004·005 확정: 연속일·week 는 `read` 기준, 오늘 미완료 시 어제부터 집계, 소급은 당일만 | 확정 · Phase 2 sub-PR B |
