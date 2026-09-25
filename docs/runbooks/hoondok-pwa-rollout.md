# 훈독 PWA 롤아웃·롤백 runbook

- 대상: `/hoondok` 을 운영에서 켜는 배포(`HOONDOK_ENABLED=1`)와 그 되돌리기. 근거 계획은 [`PLAN-HD-001` §6](../plans/active/2026-09-17-hoondok-mvp.md).
- 상태: **2026-09-20 기준 운영은 플래그 ON** 이다. 현재 태그는 web **`a93a6c7`** · backend·admin `c066b02` 이고 실데이터 9라우트가 200, 프리뷰 8라우트가 404 다. 같은 날 사후 실측으로 확인했을 때는 web `aba5240` 이 이미 `HOONDOK_ENABLED=1` 로 떠 있었는데 **그 최초 ON 배포를 언제 누가 실행했는지는 기록이 없다** — 이 문서에 실행 기록을 남기지 않은 채 배포됐다. 작성 시점(2026-09-19)의 상태는 플래그 OFF(web `b70b6c8`, `/hoondok/*` 전부 404)였다. 측정값과 결정은 [§실행 기록](#실행-기록)에 있다.
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
| DB schema | VM Postgres | **선행 `alembic downgrade`** — 마이그레이션이 포함된 배포에서만 (아래 층 0) |
| 앱 코드·라우트 | VM 이미지 | `rollback-web` 또는 `deploy-web HOONDOK_ENABLED=0` |
| 서비스워커 등록·캐시 | **사용자 브라우저** | 킬스위치 배포 (아래) |

층 0 은 backend, 층 1·2 는 web 이야기다. web 만 되돌릴 때는 층 1 부터 읽으면 된다.

### 층 0 — backend: 마이그레이션이 포함된 배포는 `rollback-backend` 단독으로 되돌아가지 않는다

`apps/api/Dockerfile` 의 기본 CMD 가 이렇다.

```
sh -c "alembic upgrade head && exec uvicorn ..."
```

새 revision 을 배포한 뒤 구 이미지로 되돌리면, 구 이미지의 `alembic/versions/` 에는 그 revision 파일이 **없다**. 그래서 `alembic upgrade head` 가 `Can't locate revision identified by <새 revision>` 으로 죽고 컨테이너가 기동하지 못한다. `make rollback-backend TAG=<구 sha>` 만으로는 서비스가 돌아오지 않는다는 뜻이다.

이 CMD 는 고치지 않는다 — `|| true` 로 넘기면 코드와 DB schema 가 어긋난 채 뜨고, 그것을 막으려고 넣은 장치다(`dev-log 41`, 2026-04-25 incident).

**되돌리는 순서는 2단계다. 새 이미지가 아직 VM 에 있을 때 downgrade 를 먼저 돌린다.**

```bash
# 1. 아직 새 이미지로, 구 이미지가 아는 revision 까지 내린다
ssh truewords-oracle 'cd ~/truewords && sudo docker compose run --rm --no-deps \
  backend alembic downgrade <구 이미지의 head revision>'

# 2. 그 다음에 이미지를 되돌린다
make rollback-backend TAG=<구 sha>
```

순서를 바꾸면 안 된다. 이미지를 먼저 되돌리면 downgrade 를 실행할 주체(새 revision 파일을 가진 이미지)가 사라진다.

**downgrade 가 무엇을 지우는지 먼저 읽는다.** `PLAN-HD-001` §3 의 additive-only 규칙을 지킨 마이그레이션이라면 `downgrade()` 는 신규 테이블 drop 뿐이라 기존 데이터가 남는다. 신규 테이블에 쌓인 데이터는 사라진다 — 그것이 되돌린다는 뜻이다. 규칙을 벗어난 마이그레이션이라면 이 절차를 그대로 쓰지 말고 먼저 `downgrade()` 본문을 읽는다.

#### 리허설 (2026-09-22, `l6b7c8d9e0f1` 배포 전)

격리 compose(`apps/api/docker-compose.e2e.yml`, tmpfs — 운영·로컬 개발 볼륨 무접촉)에서 위 순서를 검증했다.

- 기준 이미지: `git archive c066b02` 트리로 빌드, digest `sha256:3d16e9fb2b4656f7b50ba932caac9bad3c5f5e4dcd22537aec28f90b3c837988` (`PLAN-HD-005` §9.3 이 기록한 digest 와 동일 — 재현됨)
- **실패 재현**: DB 가 `l6b7c8d9e0f1` 인 상태에서 구 이미지를 기본 CMD 로 기동 → `Can't locate revision identified by 'l6b7c8d9e0f1'`
- **1단계**: 새 이미지로 `alembic downgrade k5a6b7c8d9e0` → `content_rights`·`jeongseong_readings`·`client_error_events` 3테이블 drop
- **2단계**: 같은 구 이미지를 **기본 CMD 그대로** 기동 → `Application startup complete`, `/health` 200 `{"status":"ok"}`, `/hoondok/today` 200
- 검증 후 `alembic upgrade head` 로 격리 DB 를 `l6b7c8d9e0f1` 로 원복, 테스트 컨테이너 제거

이 결과로 `PLAN-HD-005` §9.3 의 "기본 CMD 롤백 **실패**" 와 `docs/TODO.md` Next Actions 의 배포 전 과제가 닫힌다. 원인은 스키마 비호환이 아니라 진입점 하나였고, 절차 2단계로 해소된다.

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

### 로그인 화면 점검용 QA 계정

운영에서 로그인 뒤 화면(형광펜·북마크·노트·이어 읽기·나의 정원)을 Playwright 로 점검하려고 2026-09-23 에 만든 **일반 사용자 계정**이다. 관리자 권한은 없다.

| 항목 | 값 |
|---|---|
| 이메일 | `qa.hoondok@woosung.dev` (표시 이름 `QA테스터`) |
| 비밀번호 | VM `~/truewords/qa-account.txt` (권한 600). 레포가 public 이라 여기에 적지 않는다 |

```bash
ssh truewords-oracle 'cat ~/truewords/qa-account.txt'
```

- [§베타 1차 판정 쿼리](#베타-1차-판정-쿼리-2개) 등 실사용자 지표를 볼 때 이 계정을 제외한다.
- 필요 없어지면 `users` 행과 `qa-account.txt` 를 함께 지운다.

## 실기기 증거

Phase 3 완료 기준은 실기기 설치다. 헤드리스 E2E 는 `beforeinstallprompt` 를 발사하지 않고 iOS 공유 시트를 재현하지 못한다 — 이 두 경로는 실기기로만 확인된다.

기기마다 아래를 기록한다. **Android 1대 + iOS 16.4 이상 1대**가 필요하다 — `PLAN-HD-001` §6 완료 기준이 두 플랫폼을 함께 요구한다.

| 항목 | 기록할 것 |
|---|---|
| 기기·OS | 예: iPhone 13 / iOS 17.4 · Galaxy S22 / Android 14 |
| 브라우저 | Safari 17.4 · Chrome 126 |
| 설치 경로 | 설치 카드 변형(`ios`·`prompt`·`manual`) 과 실제로 설치됐는지 |
| standalone 확인 | 홈 화면 아이콘에서 열었을 때 브라우저 주소창이 없는지 (scope 검증) |
| 가입 | 초대 코드 입력 → 201, 틀린 코드 → 403 안내. **게이트 OFF 기간에는 코드 없이 201** 만 확인한다(아래 [§실행 기록](#실행-기록)의 2026-09-20 결정) |
| 훈독 | 홈 → 훈독하기 → 완료 → 연속일 1 |
| 오프라인 | 기내 모드에서 앱 실행 → `/hoondok/offline` 안내 |
| 아이콘 | 홈 화면 아이콘이 감귤 배경 "훈" 으로 보이는지 |
| 알림 (Phase 4, 운영 ON 뒤에만) | 설정에서 훈독하기 토글 ON → 권한 허용 → `send_hoondok_push.py --to-email` 발송 → 잠금 화면 도착 → 탭 시 `/hoondok` 이 열리는지. iOS 는 홈 화면 설치 상태에서만 |

**어디에 적나.** 아래 [§실행 기록](#실행-기록)에 `### <날짜> — 실기기 증거 (<기기>)` 절을 하나 만들어 채운다. `PLAN-HD-001` §6 표의 실기기 행은 그 절을 가리키게 되고, `docs/plans/completed/` 로 옮길 때 함께 첨부한다. 빈 양식:

```markdown
### 2026-__-__ — 실기기 증거 (Android / iOS)

| 항목 | Android | iOS |
|---|---|---|
| 기기·OS |  |  |
| 브라우저 |  |  |
| 설치 경로(카드 변형) |  |  |
| standalone(주소창 없음) |  |  |
| 가입 |  |  |
| 훈독 완료 → 연속일 1 |  |  |
| 오프라인 안내 |  |  |
| 아이콘 |  |  |
| 알림 도착 → 탭 시 `/hoondok` (Phase 4) |  |  |
```

한쪽 기기만 끝났으면 그 열만 채우고 나머지는 비워 둔다 — **채워지지 않은 칸을 추정으로 메우지 않는다.**

## 알림 운영 ON 절차 (PLAN-HD-006 · Phase 4)

코드는 main 에 있어도 **VAPID 3값이 VM `.env` 에 없으면 알림은 꺼져 있다** — `GET /hoondok/push/config` 가 `enabled=false` 를 내고 설정 화면 토글은 "준비 중", 발송기는 exit 0 no-op 이다. 켜는 조건은 [`PLAN-HD-006` §6](../plans/active/2026-09-22-hoondok-notifications.md): 실기기 증거 ✅ + `mission_logs` 7일 적재 + 아래 베타 판정 2수치 + 사용자 승인.

```bash
# 0. 로컬에서 VAPID 키 1회 생성 (py-vapid 는 backend 의존성에 포함)
cd apps/api && uv run python - <<'PY'
from py_vapid import Vapid, b64urlencode
from cryptography.hazmat.primitives import serialization
v = Vapid(); v.generate_keys()
print("HOONDOK_VAPID_PUBLIC_KEY=" + b64urlencode(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)))
print("HOONDOK_VAPID_PRIVATE_KEY=" + b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32, "big")))
print("HOONDOK_VAPID_SUBJECT=mailto:<운영 연락 메일>")
PY
# 1. VM .env 에 3줄 추가 (비밀 키는 어디에도 커밋·붙여넣기 금지) → backend 만 재생성
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env up -d --no-deps backend'
curl -s https://truewords.woosung.dev/api/backend/hoondok/push/config   # {"enabled":true,"public_key":"..."}
# 2. cron 등록 (15분 간격, infra/oracle-vm/README.md §정기 작업)
#    */15 * * * *  /home/ubuntu/truewords/send-hoondok-push.sh >> /home/ubuntu/truewords-cron.log 2>&1
# 3. 실기기에서 토글 ON → 즉시 발송으로 증거 확보
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend python scripts/send_hoondok_push.py --to-email <내 계정> --execute'
# 4. 다음 날 ops-check 의 hoondok-push 행이 OK 인지
make ops-check
```

**되돌리기**: `.env` 에서 3줄 제거 → backend 재생성. 토글은 다시 "준비 중", 발송기는 no-op. 이미 저장된 `push_subscriptions` 행은 남지만 발송되지 않는다(삭제는 사용자의 토글 OFF 또는 계정 삭제). cron 줄은 그대로 두어도 무해하다.

**키 교체**: 공개키가 바뀌면 기존 구독은 전부 무효(발송 시 4xx → 자동 삭제)이고 사용자가 토글을 다시 켜야 한다. 교체는 사고 대응에만.

### 베타 1차 판정 쿼리 2개

`apps/api/scripts/hoondok_beta_metrics.sql` 을 운영 postgres 에 그대로 흘린다. 별도 이벤트 수집기 없이 `users.created_at` 과 `mission_logs` 만 쓴다.

```bash
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < apps/api/scripts/hoondok_beta_metrics.sql
```

| 지표 | 정의 | `[가정]` |
|---|---|---|
| 7일 중 5일 완료 비율 | 가입 후 7일이 지난 사용자 중, 최근 7일(KST) `read` 완료일이 5일 이상인 비율 | — |
| D7 재방문 | 가입일 +7일 이후에 `mission_logs` 가 1건 이상인 비율 | 방문 로그가 없어 **완료 기록을 방문의 대리 지표**로 쓴다. 완료 없이 열어만 본 사용자는 미방문으로 센다(보수적) |

두 수치를 `PLAN-HD-006` §7 진행 기록에 날짜와 함께 적고, 그 뒤 F2 AI 질문 우선순위 ADR 의 근거로 쓴다.

## AI 낭독 목소리 운영 ON (PLAN-HD-011)

코드가 배포돼도 **`GOOGLE_TTS_API_KEY` 가 VM `.env` 에 없으면 AI 목소리는 꺼져 있다** — `GET /hoondok/tts/voices` 가 `enabled=false`, 단락 음성은 503 `TTS_DISABLED` 이고 화면은 브라우저 음성으로 읽는다. 켜기 전 [`PLAN-HD-011` §6 확인 필요](../plans/active/2026-09-25-hoondok-ai-voice.md) 중 "협회 본문을 Google Cloud 로 보내는 것" 확인이 먼저다.

```bash
# 0. GCP 프로젝트 gcp-project-504004 에서 Cloud Text-to-Speech API 사용 설정 →
#    사용자 인증 정보 → API 키 만들기 → "키 제한: Cloud Text-to-Speech API" 하나만 선택(애플리케이션 제한은 없음, 서버 호출).
#    결제 계정이 연결돼 있어야 한다. Chirp 3 HD 무료 한도는 월 100만 자, 앱 상한은 90만 자(HOONDOK_TTS_MONTHLY_CHAR_LIMIT).
# 1. 캐시 디렉터리 — backend 컨테이너 사용자(appuser) uid 로 소유를 맞춘다. [확인 필요] uid 는 이미지에서 실측한다.
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend id -u'   # 예: 1000
ssh truewords-oracle 'sudo mkdir -p /opt/truewords/tts-cache && sudo chown <위 uid>:<위 uid> /opt/truewords/tts-cache'
# 2. VM .env 에 키 1줄 (어디에도 커밋·붙여넣기 금지). compose 가 HOONDOK_TTS_CACHE_DIR=/data/tts-cache 와 볼륨을 이미 건다.
#    GOOGLE_TTS_API_KEY=<키>
# 3. 새 compose(볼륨·HOONDOK_TTS_CACHE_DIR)를 VM 에 올린다 — make deploy-* 는 compose 파일을 복사하지 않는다
scp infra/oracle-vm/docker-compose.yml truewords-oracle:~/truewords/docker-compose.yml
# 4. backend 먼저 (alembic s4d5e6f7a8b9 hoondok_tts_usage 포함)
make deploy-backend
curl -s https://truewords.woosung.dev/api/backend/hoondok/tts/voices | jq '{enabled, limit_reached}'   # true, false
# 5. web 나중 (목소리 시트·견본 mp3). backend 가 먼저 있어야 시트가 AI 목록을 받는다
make deploy-web
# 6. 확인: 로그인 → 원문 뷰 듣기 → 첫 단락 1~2초 로딩 후 재생, 같은 단락 두 번째는 즉시(X-Tts-Cache: hit)
ssh truewords-oracle 'sudo du -sh /opt/truewords/tts-cache; sudo find /opt/truewords/tts-cache -name "*.mp3" | wc -l'
```

- **사용량**: `SELECT month, sum(chars) FROM hoondok_tts_usage GROUP BY 1 ORDER BY 1 DESC;` — 새로 합성한 글자 수만 있다(캐시 적중 제외, 사용자 정보 없음). 상한 도달이면 그달은 새 단락을 만들지 않고 이미 만든 단락만 준다.
- **디스크**: 단락 1개 ≈ 수십~수백 KB(mp3). [확인 필요] 한 달 사용 뒤 `du -sh` 로 증가량을 보고 정리 기준을 정한다. 지워도 다음 청취 때 다시 만들어진다(그만큼 글자 수를 다시 센다).
- **되돌리기**: `.env` 에서 키 줄 제거 → backend 재생성(`up -d --no-deps backend`). 화면은 즉시 브라우저 음성으로 돌아가고 캐시 파일은 남는다. 키 유출 의심 시 GCP 콘솔에서 키를 먼저 삭제한다.

## 말씀 서고 개통 절차 (PLAN-HD-007)

운영 `content_rights` 는 0행이라 `/hoondok/library` 가 `{"items":[],"works":[]}` 다. 권리 게이트의 기본값이 "전부 비노출" 이라 결함이 아니고, 아래 순서로 **원장을 채우고 운영자가 승인해야** 서고·검색·원문이 보인다. 근거는 [`PLAN-HD-007` §6](../plans/active/2026-09-23-hoondok-library.md). 스크립트 상세는 [`infra/oracle-vm/README.md` §1회 실행 스크립트](../../infra/oracle-vm/README.md).

단계마다 사용자 승인이 필요하다(Git Safety Protocol). 순서를 바꾸지 않는다 — 4 는 3 이 만든 행을 대상으로 하고, 6 은 5 가 끝난 뒤에만 사용자에게 의미가 있다.

```bash
# 1. backend — alembic n8d9e0f1a2b3 (volume_sections · reading_positions · passage_marks · content_rights.chunk_count)
make deploy-backend
curl -s https://truewords.woosung.dev/api/backend/hoondok/library        # {"items":[],"works":[]} 이면 정상(아직 원장 0행)
# 2. admin — /hoondok/rights 시리즈 요약 + 일괄 승인 다이얼로그
make deploy-admin
# 3. 권리 원장 시드 — Qdrant volume 664 → 6시리즈 620행. 천성경·평화경·원리강론만 allowed + 검색·원문 + O1
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend \
  python scripts/seed_content_rights_from_qdrant.py --execute --allow "천성경,평화경,원리강론" --grade O1'
# 4. 장 목차 추출 — 수십 분. stdout 의 커버리지 표를 아래 실행 기록에 붙인다
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend \
  python scripts/extract_volume_sections.py --execute'
# 5. 운영자: https://truewords-admin.woosung.dev/hoondok/rights → 시리즈 요약 → "일괄 승인" 으로 말씀선집 등 나머지 시리즈의 공개 범위·등급 결정
# 6. web — 서고 3계층·형광펜·북마크·이어 읽기 화면
make deploy-web HOONDOK_ENABLED=1
# 7. 확인
make smoke-web WEB_URL=https://truewords.woosung.dev HOONDOK_ENABLED=1
curl -s https://truewords.woosung.dev/api/backend/hoondok/library | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d["works"]), "works")'   # 3 이상
```

- 3·4 는 cron 이 아니다. Qdrant 에 권이 추가될 때만 다시 돌린다. 시드 재실행은 운영자가 admin 에서 바꾼 `status`·`scope_*`·등급을 되돌리지 않는다(`--allow` 시리즈만 예외).
- 4 를 나눠 돌리려면 `--series father_anthology` 또는 `--volume "천성경.pdf"`. 장이 0건인 권은 화면이 "구간 N" 으로 폴백하므로 개통을 막지 않는다.
- 로컬 리허설(운영 사본 Qdrant + 별도 Postgres) 결과: 시드 620행(pending 617 · allowed 3), 천성경 78 · 평화경 187 · 원리강론 65 · 통일사상요강 11 · 자서전 74 구간. 저작물 → 원문 → 목차 점프 → 형광펜·북마크 → 이어 읽기 복귀를 375/768/1280 에서 확인(2026-09-23).

**되돌리기**: web 은 `make rollback-web WEB_TAG=<이전 sha>` 로 대칭이다. 원장을 닫으려면 admin 에서 시리즈를 `pending` 으로 일괄 변경하면 서고·검색·원문이 즉시 비노출 된다(테이블 삭제 불필요). backend 마이그레이션은 additive 라 이전 이미지로 돌아가도 새 테이블은 무해하게 남는다(§층 0 원칙 그대로).

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

### 2026-09-20 — 편성 재고: 8일분 투입, 완료 기준 충족

`ops-check` 의 `hoondok-today` WARN 은 **이 날 해소되지 않았다.** 운영 DB 쓰기는 별도 승인이고, 편성 입력은 편성자가 admin 화면에서 한다(`PLAN-HD-001` 결정 5).

같은 날 편성 입력을 돕는 [`PLAN-HD-003`](../plans/active/2026-09-20-hoondok-curation-assist.md) 편성 후보 찾기(추출형, [API-HD-012](../specs/api/hoondok-api.md))를 구현했다. 코퍼스 원문을 검색해 폼을 채우며 생성 AI 가 본문을 만들지 않는다. **같은 날 backend·admin 배포를 마쳐 운영 admin 편성 화면에서 쓸 수 있다**(위 절). 편성 입력 자체는 admin 로그인이 필요하므로 편성자가 한다.

편성자가 admin 편성 화면에서 입력해 **앞으로 8일분**이 됐다. `PLAN-HD-001` §6 완료 기준(7일분 이상)을 넘겼다. 2건까지 넣었을 때 `ops-check` 가 먼저 초록이 됐고(오늘·내일만 보므로), 이어서 8일분까지 채웠다.

| 확인 | 결과 |
|---|---|
| `make ops-check` | **불변식 8건 전부 통과** — `hoondok-today` OK "오늘·내일 편성 있음 · **앞으로 8일분**" |
| `GET /hoondok/today` | `status: "available"` · 참어머님 · 참어머님 말씀모음(2018~2019) · `authority_grade=R` |
| web `/hoondok` 홈 | "오늘의 실천" 에 편성 제목·출처·3분이 표시된다 |
| web `/hoondok/read` | 본문 전문 + 출처 줄에 **"권리 확인 중"** 점선 배지 · "훈독 완료" 버튼 · "완료 기록은 로그인 후 남아요" |

편성자가 `review_status` 를 `reviewed` 로 올렸으므로 "확인되지 않음" 배지는 뜨지 않는다. `authority_grade=R` 배지는 그대로 보인다 — 권리 확인 전이라는 표시는 유지된다.

`make smoke-web WEB_URL=https://truewords.woosung.dev HOONDOK_ENABLED=1` 최종 실행(18:00): **12건 OK · `sw-cache` WARN 1**(위 §Cloudflare 캐시의 알려진 WARN).

**다음 WARN 시점**: 8일분이므로 2026-09-27 경 오늘·내일 편성이 끊긴다. 그 전에 채운다.


### 2026-09-20 — web 배포: PLAN-HD-002 실데이터 화면 노출 (`a93a6c7`)

`WEB_TAG` 랙(`aba5240`)을 해소했다. backend·admin 은 같은 날 이미 `c066b02` 였고 **이 배포에서 건드리지 않았다**(`--no-deps`, 배포 후 backend `Up 2 hours`).

| 항목 | 값 |
|---|---|
| 배포 전 태그(롤백 대상) | web **`aba5240`** · backend `c066b02` · admin `c066b02` |
| 배포 후 태그 | web **`a93a6c7`** · backend `c066b02`(무변경) · admin `c066b02`(무변경) |
| 명령 | `make deploy-web WEB_URL=https://truewords.woosung.dev ADMIN_URL=https://truewords-admin.woosung.dev HOONDOK_ENABLED=1` |
| alembic | `k5a6b7c8d9e0 (head)` — 2026-09-20 backend 배포에서 이미 적용. 이 배포는 DB 무변경 |
| 컨테이너 | 6개 정상. web `Healthy`(46초), 나머지 재생성 없음 |
| 이미지 GC | `truewords-web:8980e0c` 삭제, 122MB 회수, 디스크 37% |
| `make ops-check` | **8건 전부 OK** — `hoondok-today` OK "오늘·내일 편성 있음 · 앞으로 8일분" |
| `make smoke-web HOONDOK_ENABLED=1` | **12건 OK** · `sw-cache` WARN 1(§Cloudflare 캐시의 알려진 WARN) |

**backend 는 배포하지 않았다.** 세션 시작 시 브리핑은 `BACKEND_TAG=aba5240` 이었으나 실측은 `c066b02` 였다 — 새 API 3종(API-HD-009/010/011)과 alembic `k5a6b7c8d9e0` 은 같은 날 PR #301 배포에서 이미 운영에 들어가 있었다(위 절). 브리핑이 지정한 `4e15f8c` 로 backend 를 배포했다면 API-HD-012(편성 후보 찾기)를 운영에서 제거하는 **후퇴 배포**가 됐다. 당시 `deploy-guard` 는 이것을 막지 못했다 — `4e15f8c` 도 `origin/main` 의 조상이라 가드를 통과했다. **그때의 가드는 "main 밖"만 막지 배포 태그가 현재 운영보다 앞선지는 보지 않았다.**

> **해소(2026-09-21, `PLAN-HD-004` 트랙 A)** — `deploy-guard` 가 VM `~/truewords/.env` 의 `<DEPLOY_SERVICE>_TAG` 를 읽어 **운영 태그가 배포할 HEAD 의 조상인지** 확인하고, 아니면 사라지는 커밋을 출력하고 중단한다(`Makefile` `deploy-guard`, 커밋 `e89b638`). 위 시나리오는 이제 차단된다 — `git merge-base --is-ancestor 4e15f8c c066b02` 가 참이므로 `4e15f8c` 배포는 후퇴로 판정된다. `.env` 를 못 읽으면 "첫 배포" 로 보지 않고 중단한다(`fcf9496`). `FORCE_DEPLOY=1` 은 그대로 예외다.

#### 라우트 전수 실측

실데이터 9개 전부 200:

| 경로 | 결과 |
|---|---|
| `/hoondok` · `/read` · `/onboarding` · `/offline` | 200 (기존) |
| `/hoondok/garden` · `/settings` · `/ask` · `/ask/[id]` · `/ask/log` | **200 (신규)** |

프리뷰 셸 8개 전부 404 — `NEXT_PUBLIC_HOONDOK_PREVIEW` 누출 없음:

| 경로 | 결과 |
|---|---|
| `/hoondok/library` · `/search` · `/words/[id]` | 404 |
| `/hoondok/worship` · `/sermons` · `/request` · `/challenge/[id]` | 404 |
| `/hoondok/family` | 404 |

누출이 구조적으로 불가능한 이유: `apps/web/Dockerfile` 에는 `NEXT_PUBLIC_HOONDOK_ENABLED` ARG 하나뿐이고 `NEXT_PUBLIC_HOONDOK_PREVIEW` 는 Dockerfile·Makefile 어디에도 없다. 넘길 경로 자체가 없다.

`/hoondok/search` 는 실데이터가 아니라 **프리뷰 8라우트 중 하나**다(말씀 3 = `library`·`search`·`words/[id]`). 404 가 정상이다.

#### 브라우저 확인 (375×812)

| 화면 | 결과 |
|---|---|
| `/hoondok` | 오늘 편성 렌더 — 2026-09-20, "예수님께서는 다시 와서는 어린양 잔치를…"(참어머님 말씀모음 2018~2019) |
| `/hoondok/ask` | 오늘 읽은 말씀 + 예시 질문 3개 + 입력 폼 |
| `/hoondok/garden` | 로딩 → 비로그인 안내("로그인하면 훈독 기록과 정성을 볼 수 있어요") 정상 전환 |
| `/hoondok/settings` | 알림 4종(전부 "준비 중") + 잠금 화면 문구 + 설치 안내 |
| 하단 탭 | 링크는 `오늘 훈독`·`AI 질문`·`나의 정원` **3개뿐**. 말씀·가정예배는 `isDisabled` 라 404 로 가는 죽은 링크가 없다(`tabs.ts` `TAB_STAGE` preview) |
| 콘솔 | 기능 오류 0건. `auth/me` 401(비로그인 기대 동작) + Next 폰트 preload 경고만 |

#### 메모리 (플래그 ON · 실데이터 화면 노출 후)

§메모리 의 2026-09-19 OFF 기준 재측정이다.

| 컨테이너 | 2026-09-19 (OFF) | 2026-09-20 (ON·13화면) | 한도 |
|---|---|---|---|
| web | 57.1 MiB | **53.1 MiB** | 512 MiB (10.4%) |
| admin | 51.9 MiB | 47.1 MiB | 512 MiB (9.2%) |
| backend | 577.9 MiB | 540.8 MiB | 3 GiB (17.6%) |

**늘지 않았다.** 라우트가 4개 → 9개로 늘었지만 Next standalone 서버의 상주 메모리는 변하지 않는다. §메모리 의 `[가정]`("큰 변화는 예상하지 않는다")이 실측으로 확인됐다.

#### 되돌리기

```bash
make rollback-web TAG=aba5240
```

이 배포는 `sw.js` 를 바꾸지 않았다 — `aba5240`·`a93a6c7` 의 파일이 같고, 서빙된 `SW_VERSION 2026-09-19.1` 이 레포 값과 일치한다. 층 2(킬스위치) 위험은 이 배포로 늘지 않았다.

#### 남은 것

- **실기기 증거**(§실기기 증거) — 헤드리스로 대체 불가. `PLAN-HD-001` §6 완료 기준표에서 **아직 닫히지 않은 마지막 항목**이다. 함께 열려 있던 "배포 트리 기준 `make e2e` 재실행" 은 `PLAN-HD-004` 최종 게이트가 닫았다 — 운영 태그 `a93a6c7`(web)·`c066b02`(backend·admin)가 둘 다 그 트리의 조상이라 배포된 코드를 포함한다.
- **`make ci` 의 `docs:check` 로컬 오탐**: `tooling/checks/docs-links.mjs:10` 의 `walk()` 가 `fs.readdirSync` 로 트리를 걸으며 `.gitignore` 를 보지 않아, gitignore 대상인 `docs/guides/*.html`(`.gitignore:40`)을 검사해 missing-anchor 11건을 낸다. GHA 체크아웃에는 그 파일이 없어 원격 CI 는 통과한다. `make ci` 가 여기서 멈춰 뒤의 `pnpm test`·`lint`·`build`·`typecheck` 에 **도달하지 못하므로** 이 배포에서는 따로 실행했다(전부 green, pytest 1069 passed). 배포와 무관한 별도 건.
  - **해소(2026-09-21, `PLAN-HD-004` 트랙 A `54dc8ea`)**: `walk()` 가 `git ls-files --cached --others --exclude-standard` 를 gitignore 판정의 정본으로 써서 대상 파일을 건너뛴다(목록을 못 얻으면 경고 후 전부 검사한다 — 조용히 건너뛰지 않는다). 실측으로 `make ci` 가 **exit 0 으로 끝까지 돈다** — docs:check 문서 190 · 링크 324 · 새 오류 0, 이어서 `test`·`lint`·`build`·`typecheck` 까지 도달한다.

### 2026-09-22 — PLAN-HD-005 배포: 여정 잇기 3서비스 (`a425217`)

`#305`(디자인 품질)·`#307`(reading journeys)·`#309`(이 runbook)이 쌓여 운영보다 6커밋 앞서 있던 main 을 배포했다. 배포 전 상태는 web `a93a6c7` · admin·backend `c066b02` · DB `k5a6b7c8d9e0` 였다.

선행: [§되돌리기 층 0](#층-0--backend-마이그레이션이-포함된-배포는-rollback-backend-단독으로-되돌아가지-않는다) 의 롤백 리허설을 먼저 통과시켰다. 이 배포가 `l6b7c8d9e0f1` 을 들여오므로 되돌리기 경로가 먼저 증명돼 있어야 했다.

순서는 `PLAN-HD-001` §6 대로 backend → admin → web 이고 각 단계 별도 승인이었다.

| 단계 | 명령 | 결과 |
|---|---|---|
| backend | `make deploy-backend` | `a425217` healthy. entrypoint 검증(alembic 1.19.1 · uvicorn 0.42.0) 통과 |
| DB | (backend CMD 자동) | `k5a6b7c8d9e0` → **`l6b7c8d9e0f1`** 적용 확인 |
| admin | `make deploy-admin` (+`DEMO_ADMIN_EMAIL`) | `a425217` healthy |
| web | `make deploy-web HOONDOK_ENABLED=1` | `a425217` healthy |
| smoke | `make smoke-web HOONDOK_ENABLED=1` | **12건 OK** · `sw-cache` WARN 1 (§Cloudflare 캐시의 알려진 WARN, FAIL 아님) |
| ops-check | `make ops-check` | **불변식 8건 전부 통과** · 컨테이너 6개 정상 · `hoondok-today` "앞으로 6일분" |

공개 라우트 9개 전부 200 (`/hoondok`·`read`·`library`·`search`·`garden`·`settings`·`ask`·`ask/log`·`offline`), 신규 공개 API `GET /hoondok/library` 200.

**`deploy-admin` 은 `DEMO_ADMIN_EMAIL` 을 요구한다.** 클라이언트 라우팅 힌트라 빌드에 구워지고, 비우면 모든 계정이 access-denied 로 간다. 값은 VM `.env` 의 것과 같아야 한다 — 레포에 두지 않으므로 배포할 때 VM 에서 읽어 넘긴다.

#### 남은 운영 입력 — 서고가 비어 있다

`GET /hoondok/library` 가 `{"items":[]}` 를 돌려준다. `content_rights` 0행이기 때문이고, **설계대로다** — 권리 게이트의 기본값이 "전부 비노출"이다(`PLAN-HD-005` §1-4). 코드 결함이 아니다.

서고·검색·원문이 사용자에게 보이려면 운영자가 admin `/hoondok/rights` 에서 저작물을 승인해야 한다. 그 전까지 서고 탭은 빈 상태 + 홈 귀환 CTA 로 동작한다(빈 서고 대응은 `PLAN-HD-005` P0 으로 처리됨).

편성과 같은 성격의 운영 입력이며, 편성 잔여분은 이 시점에 6일분이다.

### 2026-09-23 — 말씀 서고 개통: 3서비스 `1c26429` + 원장 시드 + 3시리즈 목차

[§말씀 서고 개통 절차](#말씀-서고-개통-절차-plan-hd-007) 1~4 단계. 4 는 사용자 결정으로 **천성경·평화경·원리강론만** 돌렸고, 말씀선집 615권 추출과 5(운영자 일괄 승인)는 보류했다.

| 단계 | 결과 |
|---|---|
| backend·admin·web | 이전 `552f96c`·`a425217`·`d41aeb1` → 모두 `1c26429` healthy. alembic **`n8d9e0f1a2b3`** 적용. `smoke-web` 12건 OK(`sw-cache` WARN 1, 알려진 항목) |
| 원장 시드 | `content_rights` 620행 — allowed 3(천성경·평화경·원리강론, 검색·원문, O1) · pending 617(말씀선집 615 · 통일사상요강 · 자서전) |
| 목차 추출 | `--series` 로 3회. 천성경 L1 13 · L2 65 / 평화경 10 · 177 / 원리강론 12 · 53. 0건 권 없음, 권당 약 5초 |
| 확인 | `GET /hoondok/library` → 3 works |
