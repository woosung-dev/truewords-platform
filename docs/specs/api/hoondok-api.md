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
- Phase 2 항목의 필드 표는 `[가정]`이며 구현 PR 에서 확정한다.

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

## API-HD-002 `POST /hoondok/auth/signup` (Phase 2) `[가정]`

요청 `{ email, password, display_name, consent_version }` → 201 `{ user: { id, email, display_name } }` + `Set-Cookie: hoondok_token`. 409 이메일 중복, 422 검증 실패. 약관 문구(`DEC-PWA-001` `[확인 필요]`) 확정 전에는 `consent_version` 을 받지 않는다.

## API-HD-003 `POST /hoondok/auth/login` · `logout` · `GET /hoondok/auth/me` (Phase 2) `[가정]`

- login: `{ email, password }` → 200 `{ user }` + 쿠키. 401 자격 불일치(이메일 존재 여부를 구분하지 않는다).
- logout: 204 + 쿠키 만료.
- me: 200 `{ user }`, 401 미인증. 웹 `features/identity/` 게이트가 401 을 받으면 `/hoondok/onboarding?returnTo=` 로 보낸다.

## API-HD-004 `GET /hoondok/me/summary` (Phase 2) `[가정]`

200 `{ today: { read: bool, pray: bool, study: bool }, streak_days, best_streak_days, total_days, week: [{ date, done }] × 7 }`. 연속일은 `mission_logs` 에서 KST 자정 기준으로 계산하며 저장하지 않는다. 401 미인증.

## API-HD-005 `POST /hoondok/missions/{kind}/complete` (Phase 2) `[가정]`

`kind ∈ {read, pray, study}`. 201 `{ mission_date, kind, completed_at }`. 409 같은 날 같은 kind 재요청(unique 제약). 401 미인증(`admin_token` 만 있는 브라우저도 401). 422 알 수 없는 kind.

---

## 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 5 API 로 축소. `today` 는 항상 200 + `status` 로 부재를 표현 | 확정 · 계획 §1-8 |
| 2026-09-16 | 훈독 인증 쿠키 `hoondok_token`, `aud="hoondok"`. `admin_token` 미사용 | 확정 · 계획 §1-4 |
