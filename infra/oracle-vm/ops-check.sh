#!/usr/bin/env bash
# 운영 불변식 점검 — 예약 작업이 "돌지 않은" 것까지 잡는다.
#
# ── 왜 이 스크립트가 필요한가 ────────────────────────────────────────────────
# 2026-07-24~29, `cache-cleanup.yml` 이 GitHub Actions 청구 차단으로 5일간
# 매일 실패했는데 아무도 몰랐다. 조사에서 두 가지가 확인됐다.
#
#  1. GitHub 은 알림을 만들지 않았다. `gh api notifications?all=true` 가 빈
#     목록이다. "알림이 왔는데 아무도 안 봤다" 가 아니라 알림 자체가 없었다.
#
#  2. 실패한 run 의 job 은 `steps_count: 0` 이다. 청구 차단은 job 을 아예
#     시작하지 않는다. 즉 **워크플로 안에 `if: failure()` 알림 스텝을 넣어도
#     이 사고는 못 잡는다** — 스텝이 하나도 돌지 않기 때문이다.
#
# 그래서 감시자는 감시 대상과 **다른 실패 도메인**에 있어야 한다. 이 사고에서
# 유일하게 정상 작동한 도메인이 VM cron 이었다(18:00 백업은 그대로 돌았다).
# 그래서 VM 이 GHA 소유 작업의 결과까지 확인한다.
#
# 검사 대상은 "job 이 돌았는가" 가 아니라 **"결과가 기대대로인가"** 다. 후자는
# 스케줄러가 어디 있든, 돌고도 아무 일 안 했든 똑같이 잡아낸다.
#
# 같은 논리로 `gemini-key`(§6) 가 붙었다. 예약 작업은 아니지만 실패 모드가
# 동일하다 — **유일한 외부 의존이 죽으면 챗봇만 죽고 나머지는 전부 초록이다.**
# 여기서만 유일하게 외부 네트워크를 호출하므로 상한을 세 층으로 감싼다.
#
# ── 실행 ────────────────────────────────────────────────────────────────────
#   ssh truewords-oracle 'bash ~/truewords/ops-check.sh'   (또는 `make ops-check`)
#   cron: 45 18 * * *  — 백업(18:00)·캐시정리(18:00)·추천질문(일 18:30) 뒤
#
# 종료 코드 0 = 전부 정상, 1 = 위반 있음. 결과는 /opt/ops-status.json 에도 쓴다.

# set -e 를 쓰지 않는다. 한 항목이 실패해도 나머지를 끝까지 검사해야 한다.
# (restore-drill.sh 에서 고친 것과 같은 부류의 함정)
set -uo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
STATUS_FILE="${STATUS_FILE:-/opt/ops-status.json}"

# 임계값 — 근거는 각 검사 주석에.
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-8}"
REMOTE_MAX_AGE_H="${REMOTE_MAX_AGE_H:-8}"
BUCKET="${BUCKET:-truewords-backups}"
EXPIRED_MAX="${EXPIRED_MAX:-50}"
SUGGESTED_MAX_AGE_D="${SUGGESTED_MAX_AGE_D:-10}"
DISK_MAX_PCT="${DISK_MAX_PCT:-80}"

# gemini-key — 상한이 세 층이고 **이 순서를 지켜야 한다.**
#   python 예산(50) < 컨테이너 timeout(60) < 호스트 timeout(75)
# 각 층이 다른 고장을 잡는다. python 예산만 분류된 판정을 낼 수 있고, 컨테이너
# timeout 이 실제로 일을 멈추며(바깥에서는 멈출 수 없다 — §6 주석), 호스트
# timeout 은 docker daemon 자체가 먹통일 때를 위한 마지막 층이다. 뒤집으면
# 안쪽이 판정을 낼 기회를 잃는다.
# 실측 근거: embed 0.5s + generate 0.9s. 최악은 재시도 포함 44s.
GEMINI_BUDGET_S="${GEMINI_BUDGET_S:-50}"
GEMINI_EXEC_TIMEOUT_S="${GEMINI_EXEC_TIMEOUT_S:-60}"
GEMINI_HOST_TIMEOUT_S="${GEMINI_HOST_TIMEOUT_S:-75}"
# 리허설용 — 없는 경로를 주면 부트스트랩 분기를 재현할 수 있다.
GEMINI_PROBE_SCRIPT="${GEMINI_PROBE_SCRIPT:-scripts/gemini_key_probe.py}"
GEMINI_SENTINEL="GEMINI_PROBE"

cd "$TW_DIR" || exit 1
U=$(grep "^POSTGRES_USER=" .env | cut -d= -f2-)
D=$(grep "^POSTGRES_DB=" .env | cut -d= -f2-)

FAIL=0
ROWS=()

# name | verdict | detail  — 표와 JSON 을 같은 데이터로 만든다.
record() {
  local name="$1" verdict="$2" detail="$3"
  ROWS+=("${name}|${verdict}|${detail}")
  [ "$verdict" = "FAIL" ] && FAIL=$((FAIL + 1))
  return 0
}

echo "[$(date '+%F %T')] ops-check 시작"

# ── 1. Postgres 백업 신선도 (VM 로컬) ─────────────────────────────────────
# 8h: 6시간마다(00/06/12/18 UTC) + cron 지연 여유 2h. RPO 실측(2026-07-30)에서
# 하루치 유실의 실체가 채팅 메시지 ~43건(유일본)이라 6h 로 좁혔다.
# 이 검사는 "VM 은 살아 있고 DB 만 망가진" 흔한 경우의 복구 지점을 지킨다.
LATEST=$(sudo find "$BACKUP_DIR" -name 'truewords-*.dump' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1)
if [ -z "$LATEST" ]; then
  record "backup" FAIL "덤프 파일이 없음 — backup-db.sh 가 한 번도 성공하지 못했다"
else
  L_EPOCH=${LATEST%% *}
  L_PATH=${LATEST#* }
  AGE_H=$(( ( $(date +%s) - ${L_EPOCH%.*} ) / 3600 ))
  if [ "$AGE_H" -gt "$BACKUP_MAX_AGE_H" ]; then
    record "backup" FAIL "최신 덤프가 ${AGE_H}h 전 (임계 ${BACKUP_MAX_AGE_H}h) — $(basename "$L_PATH")"
  else
    record "backup" OK "${AGE_H}h 전 · $(basename "$L_PATH") · $(sudo du -h "$L_PATH" | cut -f1)"
  fi
fi

# ── 1b. 원격 사본 신선도 (Object Storage) ─────────────────────────────────
# backup-db.sh 는 업로드 실패를 **의도적으로 무시**한다 — 원격 장애가 로컬
# 백업까지 실패시키면 안 되니까. 그 관용이 곧 사각지대다. 로컬은 멀쩡한데
# 원격만 며칠째 비어 있어도 스크립트는 매번 성공으로 끝난다.
# VM 유실(인스턴스·디스크 소실) 시 유일한 복구 지점이라 별도로 확인한다.
REMOTE_T=$(/usr/local/bin/oci os object list --auth instance_principal \
             --bucket-name "$BUCKET" --query 'max(data[]."time-created")' --raw-output 2>/dev/null | tr -d '"')
if [ -z "$REMOTE_T" ] || [ "$REMOTE_T" = "null" ]; then
  record "backup-remote" FAIL "Object Storage 사본을 확인하지 못했다 — 버킷 ${BUCKET} / Instance Principal 정책 확인"
else
  R_EPOCH=$(date -d "$REMOTE_T" +%s 2>/dev/null)
  if [ -z "$R_EPOCH" ]; then
    record "backup-remote" FAIL "사본 시각 파싱 실패: ${REMOTE_T}"
  else
    R_AGE_H=$(( ( $(date +%s) - R_EPOCH ) / 3600 ))
    if [ "$R_AGE_H" -gt "$REMOTE_MAX_AGE_H" ]; then
      # 로컬이 신선한데 원격만 낡았으면 업로드 문제다. 둘 다 낡았으면 백업
      # 자체가 안 도는 것이고, 그건 backup 항목이 이미 말해 준다. 같은 원인에
      # 두 가지 진단을 내놓으면 엉뚱한 곳을 뒤지게 된다.
      if [ "${AGE_H:-9999}" -le "$BACKUP_MAX_AGE_H" ]; then
        record "backup-remote" FAIL "원격 최신 사본이 ${R_AGE_H}h 전 (임계 ${REMOTE_MAX_AGE_H}h) — 로컬은 신선하므로 **업로드가 조용히 실패**하고 있다"
      else
        record "backup-remote" FAIL "원격 최신 사본이 ${R_AGE_H}h 전 — 로컬도 낡았다. 업로드가 아니라 백업 자체 문제 (backup 항목 참조)"
      fi
    else
      record "backup-remote" OK "${R_AGE_H}h 전 · bucket ${BUCKET}"
    fi
  fi
fi

# ── 2. semantic_cache 만료 누적 ────────────────────────────────────────────
# cache-cleanup 이 GHA 에 있어서 여기서 **결과만** 본다. 스케줄러가 GHA 든
# VM 이든, 돌고도 아무 일 안 했든 똑같이 잡힌다.
# 임계 50: 정상 운영에서 하루 유입이 수십 건 규모라 하루 미실행은 통과하고
# 이틀 이상 누적되면 걸린다. 정합성 문제는 아니다(조회가 TTL 로 필터링) —
# 예약 작업이 죽었다는 신호로 쓴다.
CNT=$(sudo docker compose --env-file .env exec -T backend \
        python scripts/cleanup_semantic_cache.py --dry-run 2>/dev/null \
        | sed -n 's/.*expired=\([0-9]*\).*/\1/p' | head -1)
if [ -z "$CNT" ]; then
  record "cache-ttl" FAIL "만료 개수를 읽지 못했다 — backend 컨테이너 또는 Qdrant 확인"
elif [ "$CNT" -gt "$EXPIRED_MAX" ]; then
  record "cache-ttl" FAIL "만료 ${CNT}건 (임계 ${EXPIRED_MAX}) — cache-cleanup.yml 이 안 돌고 있다"
else
  record "cache-ttl" OK "만료 ${CNT}건"
fi

# ── 3. 추천 질문 신선도 ────────────────────────────────────────────────────
# refresh-questions 는 주 1회(일 18:30 UTC)다. 10일 = 주기 7일 + 1회 실패 여유.
# 1회 실패는 FALLBACK_PROMPTS 로 노출이 유지되므로 즉시 경보할 필요가 없다.
SUG_AGE_D=$(sudo docker compose --env-file .env exec -T postgres \
              psql -U "$U" -d "$D" -t -A -c \
              "select coalesce(floor(extract(epoch from (now() at time zone 'utc' - max(suggested_at))) / 86400)::int, 9999) from chatbot_configs;" \
              2>/dev/null | tr -d ' \r')
if [ -z "$SUG_AGE_D" ]; then
  record "suggested-q" FAIL "suggested_at 을 읽지 못했다 — postgres 확인"
elif [ "$SUG_AGE_D" -gt "$SUGGESTED_MAX_AGE_D" ]; then
  record "suggested-q" FAIL "${SUG_AGE_D}일 전 갱신 (임계 ${SUGGESTED_MAX_AGE_D}일) — refresh-questions.sh 확인"
else
  record "suggested-q" OK "${SUG_AGE_D}일 전 갱신"
fi

# ── 4. 컨테이너 상태 ──────────────────────────────────────────────────────
# cloudflared 는 healthcheck 가 없어 running 만 본다. 나머지 4개는 healthy 여야 한다.
PS=$(sudo docker compose --env-file .env ps --format '{{.Name}} {{.Status}}' 2>/dev/null)
BAD=""
for SVC in postgres qdrant backend admin; do
  echo "$PS" | grep -q "^${SVC} Up.*healthy" || BAD="${BAD}${SVC} "
done
echo "$PS" | grep -q "^cloudflared Up" || BAD="${BAD}cloudflared "
if [ -n "$BAD" ]; then
  record "containers" FAIL "비정상: ${BAD}"
else
  record "containers" OK "5개 정상 (4 healthy + cloudflared up)"
fi

# ── 5. 디스크 여유 ────────────────────────────────────────────────────────
# 80%: Qdrant 세그먼트 병합과 이미지 누적이 스파이크를 만들 수 있어 여유를 둔다.
DISK_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ -z "$DISK_PCT" ]; then
  record "disk" FAIL "사용률을 읽지 못했다"
elif [ "$DISK_PCT" -ge "$DISK_MAX_PCT" ]; then
  record "disk" FAIL "${DISK_PCT}% 사용 (임계 ${DISK_MAX_PCT}%) — docker system df / /opt 확인"
else
  record "disk" OK "${DISK_PCT}% 사용"
fi

# ── 6. Gemini API 키 생존 ─────────────────────────────────────────────────
# Gemini 는 서비스의 **유일한 외부 의존**이다. 키가 회수되거나 청구가 막히면
# 챗봇만 죽고 위 5개 검사는 전부 초록이다 (`/health` 도 200 이다). 2026-07-24
# GHA 를 5일간 죽인 것과 같은 계정 레벨 실패가 여기서도 가능하고, `GEMINI_TIER`
# 가 paid 라 rate limit 보다 청구 실패 확률이 높다 — 그건 429 가 아니라 403 이다.
#
# generateContent 하나로는 부족하다. 채팅은 semantic-cache 히트여도 매 요청
# embed_content 를 부르므로(Embedding Stage 가 CacheCheck 앞) 임베딩만 죽어도
# 채팅은 100% 실패한다. 그래서 probe 가 두 surface 를 다 찌르고, 어느 쪽이 살아
# 있는지로 원인을 갈라 준다 — `backup-remote` 와 같은 원칙이라 행은 하나다.
#
# 판정은 컨테이너 안 probe 가 스스로 내린다. bash 는 **접두사로** 그 한 줄만
# 집는다. "마지막 줄" 은 SDK 로그·진단 출력에 밀릴 수 있다.
# 판정 줄이 없는 것도 정보다 — 스크립트가 이미지에 없거나(부트스트랩) 아예 돌지
# 못한 것이고, 그건 키 실패와 다른 조치다.

# /opt/ops-status.json 의 escaping 은 `"` 만 처리한다. 이 검사는 외부(Google)
# 문자열이 detail 에 닿을 수 있는 유일한 경로라 여기서 한 번 더 막는다.
gemini_sanitize() { printf '%s' "$1" | LC_ALL=C tr -d '\\"\000-\037'; }

# containers 가 이미 backend 이상을 말했으면 두 번째 진단을 내지 않는다
# (backup-remote 와 같은 원칙 — 같은 원인에 두 진단이면 엉뚱한 곳을 뒤진다).
# backend ∈ BAD ⇒ containers FAIL ⇒ FAIL>0 이므로 SKIP 이 "전부 통과" 로 새지
# 않는다. **이 검사가 §4 뒤에 있어야 $BAD 가 scope 에 있다.**
case " ${BAD} " in
  *" backend "*)
    record "gemini-key" SKIP "backend 컨테이너가 비정상이라 확인하지 못했다 — containers 항목 참조"
    ;;
  *)
    # `sudo timeout` 순서가 중요하다. `timeout sudo ...` 로 쓰면 timeout 이
    # 비특권으로 돌고 자식은 root 라 kill(2) 이 EPERM → timeout 이 자기 시한을
    # 넘겨 waitpid 에서 매달린다.
    # 그리고 바깥 timeout 은 docker CLI 만 죽인다 — docker 에 exec 를 죽이는 API
    # 가 없어 컨테이너 안 프로세스는 고아로 남는다. 실제로 일을 멈추는 건 안쪽
    # `timeout` 이고, 바깥은 daemon 자체가 먹통일 때를 위한 층이다.
    GEMINI_OUT=$(sudo timeout "$GEMINI_HOST_TIMEOUT_S" \
                   docker compose --env-file .env exec -T backend \
                   timeout "$GEMINI_EXEC_TIMEOUT_S" \
                   python "$GEMINI_PROBE_SCRIPT" --budget-seconds "$GEMINI_BUDGET_S" 2>&1)
    # 파이프를 쓰지 않으므로 PIPESTATUS 가 필요 없다 — $? 가 곧 timeout 의 코드다.
    GEMINI_RC=$?
    GEMINI_LINE=$(printf '%s\n' "$GEMINI_OUT" | grep -m1 "^${GEMINI_SENTINEL} " || true)

    if [ -n "$GEMINI_LINE" ]; then
      GEMINI_REST=${GEMINI_LINE#"${GEMINI_SENTINEL} verdict="}
      GEMINI_VERDICT=${GEMINI_REST%% *}
      GEMINI_DETAIL=$(gemini_sanitize "${GEMINI_LINE#*detail=}")
      if [ "$GEMINI_VERDICT" = "OK" ]; then
        record "gemini-key" OK "$GEMINI_DETAIL"
      else
        record "gemini-key" FAIL "$GEMINI_DETAIL"
      fi
    elif [ "$GEMINI_RC" -eq 124 ]; then
      record "gemini-key" FAIL "${GEMINI_HOST_TIMEOUT_S}s 안에 판정이 나오지 않았다 — docker daemon 또는 backend 무응답 (컨테이너 안 python 이 고아로 남았을 수 있다)"
    elif printf '%s' "$GEMINI_OUT" | grep -qE "can't open file|No such file or directory"; then
      # 부트스트랩은 SKIP 이 아니라 FAIL 이다. "키가 살아 있음을 증명할 수 있다"
      # 는 불변식이 실제로 깨진 상태다. SKIP 이면 Gemini 를 한 번도 안 보고
      # exit 0 이 되는데, 그게 바로 없애려는 silent-green 이다.
      record "gemini-key" FAIL "이미지에 ${GEMINI_PROBE_SCRIPT} 가 없다 — 이 검사보다 오래된 backend 이미지다. make deploy-backend 후 재확인 (검사 도입 직후 1회는 예상된 실패)"
    else
      # 원문은 길고 JSON 을 깨뜨릴 수 있어 detail 에 넣지 않는다. cron 로그로 흘린다.
      printf '%s\n' "$GEMINI_OUT" >&2
      record "gemini-key" FAIL "probe 가 판정을 내지 못했다 (exit ${GEMINI_RC}) — 위 stderr 원문 확인"
    fi
    ;;
esac

# ── 출력 ──────────────────────────────────────────────────────────────────
echo
printf '%-20s %-6s %s\n' CHECK VERDICT DETAIL
for R in "${ROWS[@]}"; do
  IFS='|' read -r n v d <<< "$R"
  printf '%-20s %-6s %s\n' "$n" "$v" "$d"
done
echo

# JSON — 사람이 안 볼 때도 마지막 판정이 남아 있어야 한다.
{
  printf '{"checked_at":"%s","failures":%d,"checks":[' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$FAIL"
  SEP=""
  for R in "${ROWS[@]}"; do
    IFS='|' read -r n v d <<< "$R"
    printf '%s{"name":"%s","verdict":"%s","detail":"%s"}' "$SEP" "$n" "$v" "${d//\"/\\\"}"
    SEP=","
  done
  printf ']}\n'
} | sudo tee "$STATUS_FILE" >/dev/null

if [ "$FAIL" -eq 0 ]; then
  echo "[$(date '+%F %T')] RESULT: OK — 불변식 ${#ROWS[@]}건 전부 통과"
  exit 0
fi
echo "[$(date '+%F %T')] RESULT: ⚠️ FAIL ${FAIL}건 — 위 DETAIL 확인. 상태: ${STATUS_FILE}"
exit 1
