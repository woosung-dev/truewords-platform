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
