# 훈독 PWA 롤아웃·롤백 runbook

- 대상: `/hoondok` 을 운영에서 켜는 배포(`HOONDOK_ENABLED=1`)와 그 되돌리기. 근거 계획은 [`PLAN-HD-001` §6](../plans/active/2026-09-17-hoondok-mvp.md).
- 상태: **2026-09-20 실측 기준 운영은 플래그 ON** 이다. web `aba5240` 이 `HOONDOK_ENABLED=1` 로 배포돼 `/hoondok`·`/hoondok/read`·`/hoondok/onboarding` 이 200 이다. **그 배포를 언제 누가 실행했는지는 기록이 없다** — 이 문서에 실행 기록을 남기지 않은 채 배포됐고, 아래 값은 전부 사후 실측이다. 작성 시점(2026-09-19)의 상태는 플래그 OFF(web `b70b6c8`, `/hoondok/*` 전부 404)였다. 측정값과 결정은 [§실행 기록](#실행-기록)에 있다.
- 이 문서가 다루는 범위는 배포 순서·검증·되돌리기다. 기능 사양은 계획서와 스펙이 소유한다.

## 이 문서가 존재하는 이유

서비스워커는 **되돌리기가 대칭이 아닌 첫 배포물**이다.

지금까지의 배포는 `rollback-web TAG=<이전 sha>` 한 줄로 완전히 되돌아갔다. 이미지를 바꾸면 서버가 내주는 것이 전부 바뀌기 때문이다. 서비스워커는 다르다 — 한 번 등록되면 **사용자의 브라우저 안에서** 살고, 이미지를 되돌려도 그 등록은 사라지지 않는다. 이전 태그로 롤백해도 이미 설치한 사람은 계속 구 SW 의 캐시를 본다.

그래서 이 문서는 "배포 순서" 보다 "되돌리는 법" 에 더 많은 줄을 쓴다.

## 사전 조건

| 항목 | 확인 방법 | 기대 |
|---|---|---|
| main 에 C~E·G 가 들어가 있다 | `git log --oneline origin/main \| head` | Phase 3 통합 PR 머지 완료 |
| backend 가 최신이다 | `make deploy-backend` 선행 (A·F) | `/api/backend/hoondok/today` 200 |
| 편성 재고 | admin 훈독 편성 | **7일분 이상** (`PLAN-HD-001` §6 완료 기준) |
| 초대 코드 결정 | VM `.env` `HOONDOK_INVITE_CODE` | 켤 거면 **web 배포 전에** 넣고 backend 재시작 |
| 현재 태그 기록 | `ssh truewords-oracle 'grep _TAG ~/truewords/.env'` | 롤백 대상이 될 값을 먼저 적어 둔다 |

마지막 줄이 중요하다. `make deploy-*` 는 체크아웃된 HEAD 로 이미지를 만든다. 롤백할 때 되돌아갈 태그를 **배포 전에** 적어 두지 않으면, 사고 중에 그 값을 찾아야 한다.

## 배포 순서

각 단계는 별도 승인이다. 순서를 바꾸지 않는다 — web 이 먼저 켜지면 아직 없는 API 를 부른다.

```bash
# 1. backend (초대 코드 게이트 · 편성 API)
make deploy-backend

# 2. admin (편성 화면). 편성 화면이 이미 배포돼 있으면 생략한다.
make deploy-admin WEB_URL=https://truewords.woosung.dev ADMIN_URL=https://truewords-admin.woosung.dev DEMO_ADMIN_EMAIL=<게이트 계정>

# 3. web — 훈독을 켜는 단계
make deploy-web WEB_URL=https://truewords.woosung.dev ADMIN_URL=https://truewords-admin.woosung.dev HOONDOK_ENABLED=1

# 4. 즉시 검증
make smoke-web WEB_URL=https://truewords.woosung.dev HOONDOK_ENABLED=1
```

`deploy-web` 은 `--no-deps` 로 web 만 교체한다. `.env` 의 한 줄(다른 서비스 태그)이 바뀌면 compose 가 env_file 해시 변화로 backend 까지 재생성하는 함정이 있어(2026-09-06 실측) 프론트 배포는 항상 `--no-deps` 다.

### `make smoke-web` 이 보는 것

ops-check 는 VM **안**을 본다. 컨테이너가 전부 healthy 인데 사용자에게는 404 인 고장(터널이 구 컨테이너를 가리킴, 빌드 ARG 누락, 헤더 누락)은 바깥에서 HTTP 로만 보인다. `smoke.sh` 는 ssh 를 쓰지 않고 공개 URL 로 요청한다 — Cloudflare 엣지·터널·Next 라우팅·빌드에 구워진 플래그를 전부 통과하는 경로다.

`--hoondok` 은 조회가 아니라 **기대값**이다. 배포할 때 넘긴 값을 그대로 적어 "의도한 상태로 떠 있는가" 를 묻는다.

| 검사 | ON 기대 | OFF 기대 |
|---|---|---|
| `chat-login` `/login` | 200 | 200 |
| `api-health` `/api/backend/health` | 200 | 200 |
| `api-today` `/api/backend/hoondok/today` | 200 | 200 (backend 는 플래그를 모른다) |
| `route-home`·`route-read`·`route-onboard` | 200 | 404 |
| `noindex` | `x-robots-tag: noindex` | (검사 안 함) |
| `manifest` | 200 · `scope=/hoondok` · `no-cache` | INFO |
| `sw` | 200 · `SW_VERSION` 이 레포와 일치 · `Service-Worker-Allowed: /hoondok` | INFO |
| `sw-cache` | (헤더가 오염됐을 때만 WARN — 아래 §Cloudflare 캐시) | — |
| `icons` 4종 | 전부 200 | INFO |
| `font` | 200 · `immutable` | INFO |

**플래그 OFF 는 정적 자산을 막지 않는다.** `public/` 파일은 라우트와 무관하게 서빙되고 `apps/web` 에는 미들웨어가 없다. 그래서 OFF 배포에서도 `manifest.webmanifest`·`sw.js` 는 200 이다 — 링크가 붙지 않고 등록 코드가 돌지 않을 뿐이다. 무해하지만 사실이므로 smoke 는 OFF 에서 이것들을 FAIL 로 판정하지 않고 상태만 INFO 로 남긴다.

`scope` 값을 문자열로 단언하는 이유: `/hoondok/`(슬래시 포함)이면 standalone 에서 홈 `/hoondok` 이 범위 밖이라 브라우저 UI 가 노출된다. 200 만 보면 못 잡는다.

## 되돌리기

### 되돌릴 대상이 두 층이다

| 층 | 어디에 있나 | 되돌리는 법 |
|---|---|---|
| 앱 코드·라우트 | VM 이미지 | `rollback-web` 또는 `deploy-web HOONDOK_ENABLED=0` |
| 서비스워커 등록·캐시 | **사용자 브라우저** | 킬스위치 배포 (아래) |

### 층 1 — 라우트만 끄기 (대부분의 경우 이걸로 충분)

```bash
make deploy-web WEB_URL=https://truewords.woosung.dev ADMIN_URL=https://truewords-admin.woosung.dev HOONDOK_ENABLED=0
make smoke-web WEB_URL=https://truewords.woosung.dev HOONDOK_ENABLED=0
```

`/hoondok/*` 이 404 로 돌아간다. 이미 설치한 사람은 앱을 열면 오프라인 안내 또는 404 를 본다. 데이터는 그대로 남는다.

태그째 되돌리려면:

```bash
make rollback-web TAG=<배포 전에 적어 둔 sha>
```

### 층 2 — 서비스워커 킬스위치

`rollback-web` 만으로는 SW 가 지워지지 않는다. 이미 등록된 SW 는 브라우저가 가지고 있고, 롤백한 이미지에도 `sw.js` 가 그대로 있으면 계속 그 파일이 서빙된다.

지우려면 **새 `sw.js` 를 배포해서** 스스로 등록을 해제하게 해야 한다.

1. `apps/web/public/hoondok/sw.js` 에서 `SW_KILL = false` → `true`
2. `SW_VERSION` 을 올린다 (캐시 이름이 바뀌어야 구 캐시가 지워진다)
3. 커밋 → main 머지 → `make deploy-web HOONDOK_ENABLED=1` (**ON 으로 배포한다** — OFF 로 내리면 SW 등록 컴포넌트가 안 돌아 킬 스크립트가 도달하지 못한다)
4. 사용자가 앱을 한 번 열면 `caches.keys()` 전삭제 + `registration.unregister()` 가 실행된다
5. 충분히 전파된 뒤(며칠) `SW_KILL` 을 되돌리고 플래그를 OFF 로 내린다

**전파는 즉시가 아니다.** 사용자가 앱을 열어야 실행된다. 열지 않는 사람에게는 영원히 도달하지 않는다 — 베타 10~20명 규모라 개별 연락이 현실적인 최후 수단이다.

킬스위치가 도달하려면 두 가지만 참이면 된다 — **엣지가 최신 `sw.js` 를 내고**, **브라우저가 그 최신본을 가져오는 것**. smoke 의 `sw` 검사가 그 둘을 건다(서빙된 `SW_VERSION` vs 레포 값). 브라우저 쪽은 `register()` 의 `updateViaCache: "none"` 이 보장한다 — 아래 절이 그 이유다.

### Cloudflare 캐시 — `sw.js` 의 `no-cache` 는 브라우저에 도달하지 않는다

**엣지는 origin 의 `Cache-Control` 을 그대로 통과시키지 않는다.** Cloudflare 의 Browser Cache TTL 기본값이 4시간이고, origin 값이 그보다 작거나 `max-age` 가 아예 없으면 `max-age=14400` 으로 덮어쓴다. 2026-09-19 운영에서 같은 서버의 세 응답이 서로 다르게 변형된 것을 실측했다:

| 파일 | origin | 엣지 | 왜 |
|---|---|---|---|
| `sw.js` | `no-cache, must-revalidate` | `max-age=14400, must-revalidate` | `max-age` 가 없어서 채워 넣음 |
| `icons/*.png` | `public, max-age=0` | `public, max-age=14400` | 4시간보다 작아서 덮어씀 |
| `_next/static/*.woff2` | `max-age=31536000, immutable` | 그대로 | 4시간보다 커서 존중 |

`.webmanifest` 는 Cloudflare 의 기본 캐시 확장자 목록에 없어(`cf-cache-status: DYNAMIC`) origin 헤더가 그대로 통과한다. **manifest 는 통과인데 `sw.js` 만 오염되는 이유가 이것이다.**

**그런데 이건 사고가 아니다.** 브라우저는 최상위 SW 스크립트에 한해 HTTP 캐시를 보지 않는다(Chrome 68+ / Safari 11.1+). `register()` 가 `updateViaCache: "none"` 을 넘기므로 import 까지 우회한다. 엣지도 stale 이 아니다 — `cf-cache-status: REVALIDATED` 로 매 요청 origin 과 대조하며, 본문 해시가 레포 파일과 일치함을 확인했다.

그래서 smoke 는 이 헤더를 **FAIL 이 아니라 `sw-cache` WARN** 으로 남긴다. FAIL 로 두면 배포마다 빨간불이 떠서 경보를 무시하는 습관만 생긴다.

WARN 을 없애려면 Cloudflare 에 Cache Rule 하나를 건다 (Page Rules 는 폐기 중이므로 **Cache Rules** 로):

- Match: `/hoondok/sw.js`
- Browser TTL: **Respect origin** — `Bypass cache` 도 되지만 엣지 캐시까지 꺼서 VM 부하가 는다. 우리가 원하는 건 브라우저 헤더만 원본대로 보내는 것이다.

**이 규칙은 레포 밖(대시보드)에 산다.** 안전은 규칙이 아니라 코드(`updateViaCache: "none"`)가 책임지고, 규칙이 조용히 지워지면 `sw-cache` WARN 이 다시 나타난다 — 그 WARN 이 이 설정을 감시하는 유일한 눈이다.

배포 후 응답이 갱신되지 않을 때 확인:

```bash
curl -sI https://truewords.woosung.dev/hoondok/sw.js | grep -i 'cache-control\|cf-cache-status\|service-worker-allowed'
```

`cf-cache-status: HIT` 이고 `age` 가 크면 엣지가 붙들고 있는 것이므로 대시보드에서 해당 경로를 purge 한다. `smoke-web` 이 `sw` **FAIL**(SW_VERSION 불일치)을 내면 여기부터 본다.

## 배포 후 확인

### 메모리

web 컨테이너는 `mem_limit: 512m` 이다. 플래그 OFF 기준 실측(2026-09-19):

| 컨테이너 | 사용 | 한도 |
|---|---|---|
| web | 57.1 MiB | 512 MiB (11.2%) |
| admin | 51.9 MiB | 512 MiB (10.1%) |
| backend | 577.9 MiB | 3 GiB (18.8%) |

훈독을 켠 뒤 다시 측정한다. 라우트 3개와 정적 자산이 늘어날 뿐이라 큰 변화는 예상하지 않지만(`[가정]`), 2MB 폰트와 SW precache 는 서버가 아니라 클라이언트 쪽 비용이므로 **확인 없이 단정하지 않는다**.

```bash
ssh truewords-oracle 'sudo docker stats --no-stream --format "{{.Name}} {{.MemUsage}} {{.MemPerc}}"'
```

### ops-check `hoondok-today`

편성은 운영자가 수기로 넣고 대체 생성이 없다. 입력이 끊기면 그날 홈은 "오늘 말씀 없음" 이 되는데, 앱은 200 이고 컨테이너는 healthy 라 다른 검사는 전부 초록이다. `ops-check.sh` §7 이 오늘·내일 편성을 세어 WARN 을 낸다.

내일까지 보는 이유는 오늘 것만 확인하면 "오늘 아침에야 오늘 게 없다" 를 알게 되기 때문이다. 하루 앞을 보면 저녁 cron 이 알려 주고 아침 전에 채울 수 있다.

WARN 이지 FAIL 이 아니다. 배포·백업이 깨진 것과 같은 급으로 다루면 빨간 판정이 흔해져 진짜 FAIL 이 묻힌다.

**스크립트를 고쳤으면 VM 에 올려야 반영된다.** `make ops-check` 는 VM 의 사본을 실행한다:

```bash
scp ./infra/oracle-vm/ops-check.sh truewords-oracle:~/truewords/
make ops-check
```

`smoke.sh` 는 같은 디렉터리에 있지만 **로컬에서 실행한다**. VM 에 올릴 필요가 없다(올라가도 무해하다).

## 실기기 증거

Phase 3 완료 기준은 실기기 설치다. 헤드리스 E2E 는 `beforeinstallprompt` 를 발사하지 않고 iOS 공유 시트를 재현하지 못한다 — 이 두 경로는 실기기로만 확인된다.

기기마다 아래를 기록한다. `docs/plans/completed/` 로 옮길 때 첨부한다.

| 항목 | 기록할 것 |
|---|---|
| 기기·OS | 예: iPhone 13 / iOS 17.4 · Galaxy S22 / Android 14 |
| 브라우저 | Safari 17.4 · Chrome 126 |
| 설치 경로 | 설치 카드 변형(`ios`·`prompt`·`manual`) 과 실제로 설치됐는지 |
| standalone 확인 | 홈 화면 아이콘에서 열었을 때 브라우저 주소창이 없는지 (scope 검증) |
| 가입 | 초대 코드 입력 → 201, 틀린 코드 → 403 안내 |
| 훈독 | 홈 → 훈독하기 → 완료 → 연속일 1 |
| 오프라인 | 기내 모드에서 앱 실행 → `/hoondok/offline` 안내 |
| 아이콘 | 홈 화면 아이콘이 감귤 배경 "훈" 으로 보이는지 |

## 실행 기록

### 2026-09-20 — 플래그 ON 상태 사후 실측

플래그 ON 배포 자체는 이 절에 기록되지 않은 채 실행됐다. **실행 날짜와 주체는 미기록이며 추정하지 않는다.**
아래는 2026-09-20 에 읽기 전용으로 측정한 값이다.

| 항목 | 값 |
|---|---|
| `BACKEND_TAG` | `aba5240` |
| `WEB_TAG` | `aba5240` — main `4e15f8c` 보다 2커밋 뒤(#299·#300 미배포) |
| `ADMIN_TAG` | `87db69a` |
| `make smoke-web WEB_URL=https://truewords.woosung.dev HOONDOK_ENABLED=1` | **12건 OK** · `sw-cache` WARN 1건 |
| `make ops-check` | 8건 OK · `hoondok-today` **WARN** (앞으로 0일분) |
| `/api/backend/hoondok/today` | `{"date":"2026-09-20","status":"none","reading":null}` |
| `x-robots-tag` (`/hoondok`) | `noindex, nofollow` |
| `HOONDOK_INVITE_CODE` (VM `.env`) | 미설정 — 게이트 OFF |

`sw-cache` WARN 은 §Cloudflare 캐시에 적힌 그 WARN 이다(엣지가 `max-age=14400` 으로 덮어씀, `updateViaCache: "none"` 이 막고 있어 무해). 서빙된 `SW_VERSION 2026-09-19.1` 은 레포 값과 일치한다.

**`WEB_TAG` 랙의 실제 영향.** 운영 web 에 있는 훈독 라우트는 `/hoondok`·`/read`·`/onboarding`·`/offline` 4개다. PLAN-HD-002(#300)의 화면 13종은 배포되지 않았고 `/hoondok/garden` 은 404 다. smoke 는 `route-home`·`route-read`·`route-onboard` 3개만 보므로 **이 랙을 잡지 못한다** — 태그 승격은 배포이므로 별도 승인 건이다.

**미확인으로 남은 것:** 플래그를 켠 날짜·주체, 실기기 설치 증거(§실기기 증거 양식), 플래그 ON 상태의 web 512m 메모리 재측정(§메모리 는 OFF 기준 값이다).

### 2026-09-20 — 초대 코드 게이트: OFF 유지 (결정)

`PLAN-HD-001` §6 F 의 `[확인 필요]`("불필요하면 F 를 생략하고 noindex·비링크 상태로 연다")에 대해 **끄고 운영한다**고 결정했다. VM `.env` 는 건드리지 않았다.

`noindex, nofollow` 는 검색 크롤러만 막는다. 링크 전달은 막지 못하므로 제한 베타의 실제 경계는 "링크를 아는 사람 전원" 이고, `[가정]` 10~20명 규모를 넘어서는 것을 기술적으로 막을 수단이 지금은 없다. 약관 문구와 법적 주체가 미정인 상태에서 불특정 계정이 쌓이면 나중에 소급 동의를 받아야 하며, 그 비용은 계정 수에 비례한다. 반대로 지금 게이트를 켜는 비용은 낮다 — 게이트 코드는 backend `aba5240` 에 **이미 배포돼 있어** 재배포·이미지 빌드 없이 VM `~/truewords/.env` 에 `HOONDOK_INVITE_CODE` 한 줄을 넣고 backend 컨테이너만 재생성하면 된다. `env_file: .env` 를 쓰는 서비스는 backend 단 하나라 다른 컨테이너 파급도 없다. 따라서 이 결정은 되돌리기 쉬우며, 가입 규모가 `[가정]` 을 넘거나 링크가 의도 밖으로 퍼진 정황이 보이면 즉시 뒤집는다.

```bash
ssh truewords-oracle 'grep -c "^HOONDOK_INVITE_CODE=" ~/truewords/.env'
```

게이트를 켰는지 확인하는 읽기 전용 한 줄이다. 켠 뒤에는 잘못된 코드로 `POST /hoondok/auth/signup` 이 403 `INVITE_REQUIRED` 를 내는지로 검증한다.

### 2026-09-20 — backend·admin 배포 (PR #301 머지)

PR [#301](https://github.com/woosung-dev/truewords-platform/pull/301) 을 main `c066b02` 로 squash 머지한 뒤 두 단계를 배포했다. **web 은 건드리지 않았다** — `WEB_TAG` 는 `aba5240` 그대로다.

| 항목 | 값 |
|---|---|
| 배포 전 태그(롤백 대상) | backend `aba5240` · admin `87db69a` · web `aba5240` |
| 배포 후 태그 | backend **`c066b02`** · admin **`c066b02`** · web `aba5240`(무변경) |
| alembic | `k5a6b7c8d9e0 (head)` — PR #300 의 `jeongseong_periods` 가 이 배포에서 적용됐다 |
| 컨테이너 | 6개 정상. admin 배포 시 backend 미재생성 확인(`--no-deps`, 배포 후 backend `Up 3 minutes`) |
| 이미지 GC | backend 3MB · admin 126MB 회수, 디스크 37% |
| `make ops-check` | 8건 OK · `hoondok-today` WARN(편성 0일분) |
| `make smoke-web HOONDOK_ENABLED=1` | **12건 OK** · `sw-cache` WARN 1(위 §Cloudflare 캐시의 알려진 WARN) |

배포로 들어간 것: 편성 후보 찾기([API-HD-012](../specs/api/hoondok-api.md), [PLAN-HD-003](../plans/active/2026-09-20-hoondok-curation-assist.md)) + PR #300 의 backend API(정성 기간·월 기록·계정 삭제).

검증 실측:

| 확인 | 결과 |
|---|---|
| `/api/backend/health` · `/hoondok/today` | 200 |
| `/api/backend/admin/hoondok/daily-readings/candidates?q=참사랑` (비인증) | **401** — 게이트 정상. 422 가 아니므로 `/candidates` 가 `/{reading_id}` 보다 먼저 매칭된다는 것이 운영에서도 확인됐다 |
| admin `/hoondok`·`/hoondok/new`·`/dashboard`·`/login` | 200 |
| web `/hoondok` · `/hoondok/garden` | 200 · 404(web 미배포라 PLAN-HD-002 13화면은 여전히 없다) |

### 2026-09-20 — 편성 재고: 아직 0일분 (미해결)

`ops-check` 의 `hoondok-today` WARN 은 **이 날 해소되지 않았다.** 운영 DB 쓰기는 별도 승인이고, 편성 입력은 편성자가 admin 화면에서 한다(`PLAN-HD-001` 결정 5).

같은 날 편성 입력을 돕는 [`PLAN-HD-003`](../plans/active/2026-09-20-hoondok-curation-assist.md) 편성 후보 찾기(추출형, [API-HD-012](../specs/api/hoondok-api.md))를 구현했다. 코퍼스 원문을 검색해 폼을 채우며 생성 AI 가 본문을 만들지 않는다. **같은 날 backend·admin 배포를 마쳐 운영 admin 편성 화면에서 쓸 수 있다**(위 절). 편성 입력 자체는 admin 로그인이 필요하므로 편성자가 한다.

임시로 7일분 후보를 운영 Qdrant 읽기 전용 조회로 뽑아 편성자에게 전달했다(원문 그대로, 등급 `R`·검수 `unverified`). 입력이 끝나면 `make ops-check` 로 `hoondok-today` 가 OK 로 바뀌는지 확인하고 이 절에 결과를 적는다.

