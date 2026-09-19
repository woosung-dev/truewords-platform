#!/usr/bin/env bash
# 배포 직후 공개 표면 스모크 — "사용자의 브라우저가 실제로 받는 응답" 을 확인한다.
#
# ── 왜 ops-check 로 충분하지 않은가 ──────────────────────────────────────────
# ops-check 는 VM 안에서 컨테이너·백업·DB 를 본다. 컨테이너가 전부 healthy 인데
# 사용자에게는 아무것도 안 보이는 고장이 실재한다 — Cloudflare Tunnel 이 구
# 컨테이너를 가리키거나, 빌드 ARG 가 빠져 라우트가 통째로 404 이거나, 헤더가
# 안 붙어 서비스워커가 등록되지 않거나. 그 층은 바깥에서 HTTP 로만 보인다.
#
# 그래서 이 스크립트는 VM 이 아니라 **공개 URL** 로 요청한다. Cloudflare 엣지,
# 터널, Next 라우팅, 빌드 시 구워진 플래그까지 한 번에 통과하는 경로다.
# 로컬에서 실행하는 것이 정상이며(`make smoke-web`), ssh 를 쓰지 않는다.
#
# ── 실행 ────────────────────────────────────────────────────────────────────
#   make smoke-web WEB_URL=https://<운영 web origin> HOONDOK_ENABLED=0
#   bash infra/oracle-vm/smoke.sh --url https://<origin> --hoondok 1
#
# `--hoondok` 은 **기대값**이지 조회가 아니다. 배포할 때 넘긴 값을 그대로 적어
# "의도한 상태로 떠 있는가" 를 묻는다. 0 인데 /hoondok 이 열려 있으면 실패다.
#
# 종료 코드 0 = 전부 통과, 1 = 위반 있음.

# set -e 를 쓰지 않는다. 한 항목이 실패해도 나머지를 끝까지 봐야 배포 직후
# "무엇이 어디까지 살아 있는지" 가 한 번에 나온다 (ops-check.sh 와 같은 이유).
set -uo pipefail

BASE_URL="${WEB_URL:-}"
HOONDOK="${HOONDOK_ENABLED:-0}"
TIMEOUT="${SMOKE_TIMEOUT_S:-15}"
# 운영 폰트 파일명은 버전이 박혀 있다(Phase 3 C). 파일을 갈면 여기도 같이 바꾼다.
FONT_FILE="${SMOKE_FONT_FILE:-PretendardVariable-1.3.9.woff2}"

while [ $# -gt 0 ]; do
  case "$1" in
    --url)     BASE_URL="$2"; shift 2 ;;
    --hoondok) HOONDOK="$2";  shift 2 ;;
    -h|--help)
      echo "사용법: $0 --url <web origin> [--hoondok 0|1]"
      exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$BASE_URL" ]; then
  echo "WEB_URL 또는 --url 로 검사할 origin 을 지정하세요 (예: https://truewords.woosung.dev)" >&2
  exit 2
fi
case "$HOONDOK" in
  0|1) ;;
  *) echo "--hoondok 은 0 또는 1 이어야 합니다 (받은 값: ${HOONDOK})" >&2; exit 2 ;;
esac
BASE_URL="${BASE_URL%/}"

FAIL=0
ROWS=()

# name | verdict | detail — ops-check.sh 와 같은 모양. 눈으로 대조하기 쉽게 맞춘다.
record() {
  ROWS+=("${1}|${2}|${3}")
  [ "$2" = "FAIL" ] && FAIL=$((FAIL + 1))
  return 0
}

HDR_FILE=$(mktemp)
BODY_FILE=$(mktemp)
trap 'rm -f "$HDR_FILE" "$BODY_FILE"' EXIT

# 응답을 한 번만 받아 상태코드·헤더·본문을 파일에 남긴다. 같은 URL 을 헤더용,
# 본문용으로 두 번 치면 그 사이 배포가 끼어들 때 서로 다른 응답을 섞어 판정한다.
fetch() {
  curl -sS -o "$BODY_FILE" -D "$HDR_FILE" -w '%{http_code}' -m "$TIMEOUT" "${BASE_URL}${1}" 2>/dev/null
}

# 헤더는 대소문자를 보장하지 않는다(HTTP/2 는 소문자, Cloudflare 가 바꾸기도 한다).
header_value() {
  tr -d '\r' < "$HDR_FILE" | grep -i "^${1}:" | tail -1 | cut -d: -f2- | sed 's/^ *//'
}

# 상태코드만 보는 검사.
check_status() {
  local name="$1" path="$2" want="$3" code
  code=$(fetch "$path")
  if [ "$code" = "$want" ]; then
    record "$name" OK "${path} → ${code}"
  else
    record "$name" FAIL "${path} → ${code} (기대 ${want})"
  fi
}

echo "[$(date '+%F %T')] smoke 시작 — ${BASE_URL} (HOONDOK_ENABLED=${HOONDOK} 기대)"

# ── 1. 시연 챗 ────────────────────────────────────────────────────────────
# 훈독 배포가 시연 챗을 깨뜨리지 않았는지부터 본다. 두 앱이 같은 이미지·같은
# 루트 layout 을 쓰므로, 훈독 쪽 변경이 여기서 먼저 터진 적이 있다(Phase 3 D
# hydration). 훈독이 꺼져 있어도 이 검사는 항상 돈다.
check_status "chat-login" "/login" 200

# ── 2. 백엔드 도달성 (web → rewrite → backend) ────────────────────────────
# `/api/backend/*` 는 web 이 백엔드로 넘기는 rewrite 다(next.config.ts). 백엔드를
# 직접 치면 이 경로가 살아 있는지 알 수 없다 — 사용자의 요청은 전부 여기로 간다.
check_status "api-health" "/api/backend/health" 200

# 훈독 API 는 web 플래그와 무관하게 늘 떠 있다(backend 는 플래그를 모른다).
# 그래서 기대값은 항상 200 이며, 이 검사가 백엔드 라우터 등록 누락을 잡는다.
check_status "api-today" "/api/backend/hoondok/today" 200

# ── 3. 훈독 라우트 (플래그가 결정한다) ────────────────────────────────────
# 세 라우트를 모두 본다. 플래그는 각 page.tsx 가 개별적으로 읽으므로(미들웨어가
# 없다) 하나만 확인하면 나머지가 열려 있어도 모른다.
HOONDOK_ROUTES=("route-home:/hoondok" "route-read:/hoondok/read" "route-onboard:/hoondok/onboarding")
if [ "$HOONDOK" = "1" ]; then
  for R in "${HOONDOK_ROUTES[@]}"; do
    check_status "${R%%:*}" "${R#*:}" 200
  done

  # 색인 차단은 훈독이 켜졌을 때 의미가 생긴다. 권리 미확정 정본이 실려 있어
  # 검색 노출을 막는 것이 베타의 전제다(PLAN-HD-001 결정 12 · REQ-PWA-001).
  CODE=$(fetch "/hoondok")
  ROBOTS=$(header_value "x-robots-tag")
  if [ "$CODE" = "200" ] && echo "$ROBOTS" | grep -qi "noindex"; then
    record "noindex" OK "/hoondok → x-robots-tag: ${ROBOTS}"
  else
    record "noindex" FAIL "/hoondok 의 x-robots-tag 가 noindex 가 아니다 (받은 값: '${ROBOTS:-없음}')"
  fi
else
  for R in "${HOONDOK_ROUTES[@]}"; do
    check_status "${R%%:*}" "${R#*:}" 404
  done
fi

# ── 4. PWA 정적 자산 ──────────────────────────────────────────────────────
# **정적 자산은 플래그를 따르지 않는다.** `public/` 파일은 Next 가 라우트와 무관하게
# 서빙하고 apps/web 에는 미들웨어가 없다. 그래서 플래그 OFF 여도 manifest·sw.js 는
# 200 이다 — 링크가 안 붙고 등록 코드가 안 돌 뿐이다(무해하지만 사실이다).
# OFF 에서 이것들을 404 로 단언하면, 자산이 아직 없는 구 이미지에서만 통과하고
# 정상 배포에서 오탐을 낸다. 그래서 OFF 에서는 상태만 INFO 로 남긴다.
MANIFEST="/hoondok/manifest.webmanifest"
SW="/hoondok/sw.js"
ICONS=(
  "/hoondok/icons/icon-192.png"
  "/hoondok/icons/icon-512.png"
  "/hoondok/icons/icon-maskable-512.png"
  "/hoondok/icons/apple-touch-icon-180.png"
)
FONT="/hoondok/fonts/${FONT_FILE}"

if [ "$HOONDOK" = "1" ]; then
  # manifest: 존재만으로는 부족하다. scope 가 `/hoondok/`(슬래시 포함)이면
  # standalone 에서 홈 `/hoondok` 이 범위 밖이라 브라우저 UI 가 노출된다 — §10
  # 2026-09-19 정정의 핵심이라 값 자체를 단언한다.
  CODE=$(fetch "$MANIFEST")
  MF_CACHE=$(header_value "cache-control")
  if [ "$CODE" != "200" ]; then
    record "manifest" FAIL "${MANIFEST} → ${CODE} (기대 200)"
  elif ! grep -q '"scope"[[:space:]]*:[[:space:]]*"/hoondok"' "$BODY_FILE"; then
    record "manifest" FAIL "scope 가 \"/hoondok\" 이 아니다 — $(grep -o '"scope"[^,]*' "$BODY_FILE" | head -1)"
  elif ! echo "$MF_CACHE" | grep -qi "no-cache"; then
    record "manifest" FAIL "Cache-Control 에 no-cache 가 없다 (받은 값: '${MF_CACHE:-없음}')"
  else
    record "manifest" OK "200 · scope=/hoondok · ${MF_CACHE}"
  fi

  # sw.js. 킬스위치가 사용자에게 도달하려면 두 가지뿐이다 — 엣지가 최신본을 내고,
  # 브라우저가 그 최신본을 가져오는 것. 그래서 FAIL 은 그 둘만 건다.
  #
  # Cache-Control 은 여기서 FAIL 이 아니다. Cloudflare 가 오리진의 `no-cache` 를
  # Browser Cache TTL 기본값 4시간으로 덮어쓰기 때문이다(2026-09-19 실측: 오리진
  # `no-cache` → 엣지 `max-age=14400`. 같은 규칙으로 아이콘 `max-age=0` 도 14400 이
  # 되고, 폰트 `max-age=31536000` 은 더 크니 그대로 통과한다). 그런데 브라우저는
  # 최상위 SW 스크립트에 한해 이 헤더를 보지 않는다 — register() 가 updateViaCache
  # "none" 을 넘기므로 HTTP 캐시를 항상 우회한다. 즉 오염된 헤더는 사고가 아니다.
  # 그래서 WARN 으로만 남긴다: Cloudflare 에 Cache Rule(Browser TTL: Respect origin)을
  # 걸어 두면 사라지고, 그 규칙이 조용히 지워지면 다시 나타난다. 레포 밖에 사는
  # 그 설정을 감시하는 유일한 눈이 이 줄이다.
  # 엣지 stale 판정은 레포의 sw.js 와 SW_VERSION 을 대조해서 한다. 배포는
  # deploy-guard(HEAD ∈ origin/main + 클린 트리)를 통과한 트리에서만 나가므로,
  # `make smoke-web` 시점의 레포 값이 곧 방금 배포한 값이다.
  sw_version() { grep -o 'SW_VERSION *= *"[^"]*"' "$1" | head -1 | sed 's/.*"\(.*\)"/\1/'; }
  REPO_SW="$(dirname "$0")/../../apps/web/public/hoondok/sw.js"

  CODE=$(fetch "$SW")
  SW_CACHE=$(header_value "cache-control")
  SW_ALLOWED=$(header_value "service-worker-allowed")
  SERVED_VER=$(sw_version "$BODY_FILE")
  REPO_VER=$([ -f "$REPO_SW" ] && sw_version "$REPO_SW")
  if [ "$CODE" != "200" ]; then
    record "sw" FAIL "${SW} → ${CODE} (기대 200)"
  elif [ "$SW_ALLOWED" != "/hoondok" ]; then
    record "sw" FAIL "Service-Worker-Allowed 가 '/hoondok' 이 아니다 (받은 값: '${SW_ALLOWED:-없음}') — scope 등록 실패"
  elif [ -z "$SERVED_VER" ]; then
    record "sw" FAIL "본문에 SW_VERSION 이 없다 — 엣지가 sw.js 가 아닌 것을 내고 있다"
  elif [ -n "$REPO_VER" ] && [ "$SERVED_VER" != "$REPO_VER" ]; then
    record "sw" FAIL "엣지가 구 스크립트를 서빙 중 (엣지 ${SERVED_VER} ≠ 레포 ${REPO_VER}) — 킬스위치가 도달하지 못한다"
  else
    record "sw" OK "200 · SW_VERSION ${SERVED_VER} · Service-Worker-Allowed: ${SW_ALLOWED}"
  fi
  if [ "$CODE" = "200" ] && ! echo "$SW_CACHE" | grep -qi "no-cache"; then
    record "sw-cache" WARN "엣지가 Cache-Control 을 '${SW_CACHE:-없음}' 로 덮어썼다 (오리진은 no-cache) — updateViaCache:none 이 막고 있어 무해하다. 없애려면 Cloudflare Cache Rule: ${SW} → Browser TTL 'Respect origin'"
  fi

  # 아이콘 4종. 하나라도 빠지면 설치 배너가 뜨지 않거나 홈 화면이 빈 칸이 된다.
  ICON_BAD=""
  for I in "${ICONS[@]}"; do
    CODE=$(fetch "$I")
    [ "$CODE" = "200" ] || ICON_BAD="${ICON_BAD}$(basename "$I")(${CODE}) "
  done
  if [ -n "$ICON_BAD" ]; then
    record "icons" FAIL "누락·오류: ${ICON_BAD}"
  else
    record "icons" OK "${#ICONS[@]}개 전부 200"
  fi

  # 폰트는 파일명에 버전이 박혀 있어 1년 immutable 이다. 헤더가 빠지면 2MB 를
  # 매 방문 다시 받는다 — 느려질 뿐 고장은 아니라 눈에 안 띈다.
  CODE=$(fetch "$FONT")
  FT_CACHE=$(header_value "cache-control")
  if [ "$CODE" != "200" ]; then
    record "font" FAIL "${FONT} → ${CODE} (기대 200) — 파일명 버전이 바뀌었으면 SMOKE_FONT_FILE 로 넘기세요"
  elif ! echo "$FT_CACHE" | grep -qi "immutable"; then
    record "font" FAIL "Cache-Control 에 immutable 이 없다 (받은 값: '${FT_CACHE:-없음}')"
  else
    record "font" OK "200 · ${FT_CACHE}"
  fi
else
  # OFF 에서는 판정하지 않는다(위 주석 참조). 자산이 이미 올라가 있는지 여부는
  # "다음 배포에서 플래그만 켜면 되는 상태인가" 를 읽는 데 쓴다.
  MF_CODE=$(fetch "$MANIFEST")
  SW_CODE=$(fetch "$SW")
  record "pwa-assets" INFO "플래그 OFF — manifest ${MF_CODE} · sw ${SW_CODE} (정적 자산은 플래그를 따르지 않는다)"
fi

# ── 출력 ──────────────────────────────────────────────────────────────────
echo
printf '%-22s %-6s %s\n' CHECK VERDICT DETAIL
for R in "${ROWS[@]}"; do
  IFS='|' read -r n v d <<< "$R"
  printf '%-22s %-6s %s\n' "$n" "$v" "$d"
done
echo

if [ "$FAIL" -eq 0 ]; then
  echo "[$(date '+%F %T')] RESULT: OK — ${#ROWS[@]}건 확인, 위반 없음"
  exit 0
fi
echo "[$(date '+%F %T')] RESULT: ⚠️ FAIL ${FAIL}건 — 위 DETAIL 확인. 롤백 절차는 docs/runbooks/hoondok-pwa-rollout.md"
exit 1
