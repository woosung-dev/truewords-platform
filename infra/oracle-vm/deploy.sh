#!/usr/bin/env bash
# truewords 운영 배포 — VM 안에서 서비스를 교체하는 **유일한** 코드 경로.
#
# ── 누가 부르나 ──────────────────────────────────────────────────────────────
#  1. GitHub Actions(release.yml) → ssh 강제 명령 → ~/truewords/bin/deploy-entry
#     → 정확한 sha 로 체크아웃한 ~/truewords/repo/infra/oracle-vm/deploy.sh (DEPLOY_MODE=auto)
#  2. 비상 경로(make deploy-* / rollback-*) → 일반 ssh → rsync 한 ~/truewords/breakglass/deploy.sh
#  두 경로가 같은 스크립트를 쓰므로 교체·검증·롤백·기록 규칙이 하나다.
#
# ── 사용법 ──────────────────────────────────────────────────────────────────
#   deploy.sh deploy <sha40> <backend|admin|web>... [--migrate]   이 sha 의 이미지로 교체 + VM 파일 동기화
#   deploy.sh sync <sha40>                                        VM 파일 동기화만 (컨테이너는 그대로)
#   deploy.sh pin <backend|admin|web> <tag>                       지정 태그로 교체 (make rollback-* 용)
#   deploy.sh rollback                                            직전 deploy 를 이전 태그로 되돌림
#   deploy.sh status                                              현재 태그 (KEY=VALUE 줄)
#
# ── 종료 코드 (release.yml·Makefile 이 이 값으로 분기한다) ────────────────────
#   0 성공 · 1 실패 · 2 인자 오류 · 3 마이그레이션 승인 필요(아무것도 바꾸지 않음) · 4 잠금 점유
#   5 교체 후 검사 실패 → 이전 태그로 복구함 · 6 실패했고 복구도 실패
#
# ── 순서가 곧 안전장치다 ────────────────────────────────────────────────────
#   디스크 → 이미지 준비(pull) → 마이그레이션 게이트 → 파일 동기화 → (승인된 migration)
#   → 이전 태그 저장 → .env 기록 → backend → admin → web 교체 → 교체마다 검사 → 기록 → GC
#   - .env 는 이미지가 전부 준비된 **뒤에만** 쓴다. pull 이 실패하면 .env 는 그대로다.
#   - 게이트(종료 3)는 파일 동기화보다 앞이다. "승인 필요" 는 정말로 아무것도 안 바꾼다.
#   - 교체는 항상 `up -d --no-deps --wait <svc>` 다. backend 는 env_file .env 를 읽어 태그 한 줄만
#     바뀌어도 설정 해시가 달라진다 — --no-deps 가 없으면 프론트 배포가 backend 를 재생성해
#     진행 중 SSE 가 끊긴다(2026-09-06 실측). 맨 `up -d` 는 다른 스택 없이도 위험하므로 쓰지 않는다.
#   - "/health 200" 은 배포 증거가 아니다. 실행 중 컨테이너의 이미지 ID 가 기대 태그의 ID 와
#     같은지까지 본다.
#
# ── 마이그레이션 정책 ───────────────────────────────────────────────────────
#   backend 이미지의 CMD 는 기동 때 `alembic upgrade head` 를 돈다. 그대로 두면 배포가 곧
#   승인 없는 스키마 변경이다. 그래서 교체 전에 이미지의 /app/ALEMBIC_EXPECTED_HEAD 와 DB 의
#   alembic_version 을 비교하고, 다르면 --migrate 없이는 종료 3 으로 멈춘다.
#   --migrate 면 backup-db.sh → 새 이미지로 `alembic upgrade head` → DB head 재확인 순이다.
#   migration 이 돈 배포는 **자동 롤백하지 않는다** — 이전 이미지는 새 revision 을 몰라 기동 때
#   upgrade 단계에서 죽는다. 복구는 사람이 백업 복원과 함께 판단한다(README §배포와 롤백).
#
# 이 VM 에는 kairos·quantbridge·nexus 도 산다. 여기서 다루는 것은 compose project
# ~/truewords 의 backend·admin·web 과 truewords 이미지뿐이다.

# set -e 를 쓰지 않는다. 실패마다 종료 코드 계약을 지켜야 해서 분기를 직접 쓴다.
set -uo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${TW_DIR}/.env"
STATE_DIR="${TW_DIR}/deploy-state"
STATE_FILE="${STATE_DIR}/last-deploy.env"
LOG_FILE="${TW_DIR}/deploy.log"
IMAGE_PREFIX="ghcr.io/woosung-dev/truewords"
DISK_MAX_PCT="${DEPLOY_DISK_MAX_PCT:-85}"
BACKUP_SCRIPT="${DEPLOY_BACKUP_SCRIPT:-${TW_DIR}/backup-db.sh}"
# deploy.log 의 마지막 칸. deploy-entry 는 auto 로 고정하고, Makefile 은 guarded|forced|manual 을 넘긴다.
DEPLOY_MODE="${DEPLOY_MODE:-manual}"
ORDER="backend admin web"
# VM ~/truewords 로 복사하는 파일 — cron 이 이 경로를 직접 부른다(README §정기 작업).
# .env·preserve-images.txt·백업은 절대 건드리지 않는다. 손으로 scp 하던 drift 를 여기서 끊는다.
SYNC_FILES="docker-compose.yml backup-db.sh cache-cleanup.sh ops-check.sh prune-images.sh refresh-questions.sh restore-drill.sh send-hoondok-push.sh"

log() { echo "[deploy $(date -u +%FT%TZ)] $*" >&2; }
die() {
  local rc="$1"
  shift
  log "❌ $*"
  exit "$rc"
}
d() { sudo docker "$@"; }
dc() { sudo docker compose --env-file .env "$@"; }

tag_key() {
  case "$1" in
    backend) echo BACKEND_TAG ;;
    admin) echo ADMIN_TAG ;;
    web) echo WEB_TAG ;;
    *) return 1 ;;
  esac
}
image_ref() { echo "${IMAGE_PREFIX}-$1:$2"; }
valid_tag() { [[ $1 =~ ^[0-9a-f]{7,40}$ ]]; }

# KEY=VALUE 파일에서 값 하나를 읽는다. 비밀 .env 를 source 하지 않는다.
read_kv() {
  local file="$1" key="$2" value
  value=$(grep -s "^${key}=" "$file" | tail -1 | cut -d= -f2-)
  value="${value%%[[:space:]]*}"
  value="${value//\"/}"
  echo "$value"
}

# .env 의 태그 한 줄만 바꾼다. 임시 파일(mktemp=0600)에 쓴 뒤 cat 으로 덮어 원본의 권한·소유를 유지한다.
set_env_tag() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp "${TW_DIR}/.env.XXXXXX") || return 1
  if awk -v k="$key" -v v="$value" '
      $0 ~ "^" k "=" { if (!done) print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }' "$ENV_FILE" >"$tmp" && cat "$tmp" >"$ENV_FILE"; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

append_log() { printf '%s %s %s %s %s\n' "$(date -u +%FT%TZ)" "$1" "$2" "$3" "$4" >>"$LOG_FILE"; }

take_lock() {
  # deploy-entry 가 이미 잡았으면 다시 잡지 않는다(같은 파일을 다시 열면 상속받은 잠금이 풀린다).
  [ "${TW_DEPLOY_LOCK_HELD:-}" = 1 ] && return 0
  exec 9>"${TW_DIR}/.deploy.lock" || die 1 "잠금 파일을 열지 못했다"
  flock -n 9 || die 4 "다른 배포가 진행 중이다 (잠금 점유)"
}

disk_gate() {
  local pct
  pct=$(df -P / | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
  [[ $pct =~ ^[0-9]+$ ]] || die 1 "디스크 사용률을 읽지 못했다"
  [ "$pct" -lt "$DISK_MAX_PCT" ] \
    || die 1 "디스크 ${pct}% 사용 (기준 ${DISK_MAX_PCT}%) — 'bash ~/truewords/prune-images.sh' 후 다시 시도"
}

# 이미지 준비: 로컬에 있으면 그대로(비상 경로는 docker load 로 넣는다), 없으면 GHCR pull,
# 그래도 없으면 레지스트리 도입 전 이름(truewords-<svc>:<tag>)을 새 이름으로 재태그한다.
ensure_image() {
  local svc="$1" tag="$2" sha="${3:-}" ref cand n
  ref=$(image_ref "$svc" "$tag")
  d image inspect "$ref" >/dev/null 2>&1 && return 0
  log "pull ${ref}"
  d pull -q "$ref" >&2 && return 0
  local cands="truewords-${svc}:${tag}"
  if [ -n "$sha" ]; then
    for n in 7 8 9 10 11 12; do cands="${cands} truewords-${svc}:${sha:0:$n}"; done
  fi
  for cand in $cands; do
    if d image inspect "$cand" >/dev/null 2>&1; then
      log "레지스트리 도입 전 이미지 ${cand} → ${ref} 재태그"
      d tag "$cand" "$ref" && return 0
    fi
  done
  return 1
}

image_head() {
  d run --rm --network none --entrypoint cat "$1" /app/ALEMBIC_EXPECTED_HEAD 2>/dev/null | tr -d '[:space:]'
}

# DB 의 alembic_version. 계정·DB 이름은 postgres 컨테이너 env 에서 읽어 .env 를 열지 않는다.
DB_HEAD=""
read_db_head() {
  local out
  # shellcheck disable=SC2016 # $POSTGRES_* 는 컨테이너 안 셸이 확장한다
  out=$(dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select version_num from alembic_version order by 1"') || return 1
  DB_HEAD=$(echo "$out" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')
  return 0
}

# 교체 직후 검사. 실패 이유를 한 줄로 남기고 1 을 돌려준다.
post_check() {
  local svc="$1" tag="$2" ref cid running want health
  ref=$(image_ref "$svc" "$tag")
  cid=$(dc ps -q "$svc" 2>/dev/null | head -1)
  [ -n "$cid" ] || { log "${svc}: 컨테이너가 없다"; return 1; }
  running=$(d inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null)
  [ "$running" = "$ref" ] || { log "${svc}: 실행 중 이미지 '${running}' ≠ 기대 '${ref}'"; return 1; }
  running=$(d inspect -f '{{.Image}}' "$cid" 2>/dev/null)
  want=$(d image inspect -f '{{.Id}}' "$ref" 2>/dev/null)
  [ -n "$want" ] && [ "$running" = "$want" ] || { log "${svc}: 컨테이너 이미지 ID 가 ${ref} 와 다르다"; return 1; }
  health=$(d inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null)
  [ "$health" = healthy ] || { log "${svc}: health '${health:-없음}'"; return 1; }
  # 컨테이너 네트워크의 서비스명으로 친다 — cloudflared 가 같은 이름으로 붙는다.
  case "$svc" in
    backend)
      dc exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://backend:8080/health', timeout=5)" >/dev/null 2>&1 \
        || { log "backend: http://backend:8080/health 실패"; return 1; }
      local want_head
      want_head=$(image_head "$ref")
      read_db_head || { log "backend: DB head 를 읽지 못했다"; return 1; }
      [ -n "$want_head" ] && [ "$DB_HEAD" = "$want_head" ] \
        || { log "backend: DB head '${DB_HEAD}' ≠ 이미지 '${want_head}'"; return 1; }
      ;;
    admin | web)
      dc exec -T "$svc" node -e "fetch('http://${svc}:3000/login').then(r=>process.exit(r.status<400?0:1),()=>process.exit(1))" >/dev/null 2>&1 \
        || { log "${svc}: http://${svc}:3000/login 실패"; return 1; }
      ;;
  esac
  return 0
}

switch_one() {
  local svc="$1" tag="$2"
  log "${svc} → ${tag} 교체"
  dc up -d --no-deps --wait --wait-timeout 300 --pull never "$svc" >&2 || { log "${svc}: compose up 실패"; return 1; }
  post_check "$svc" "$tag"
}

sync_files() {
  local f mode tmp
  [ "$SRC_DIR" = "$TW_DIR" ] && return 0
  mkdir -p "${STATE_DIR}/prev-files" || return 1
  for f in $SYNC_FILES; do
    [ -f "${SRC_DIR}/${f}" ] || { log "원본에 ${f} 가 없다"; return 1; }
    cmp -s "${SRC_DIR}/${f}" "${TW_DIR}/${f}" && continue
    [ -f "${TW_DIR}/${f}" ] && cp -p "${TW_DIR}/${f}" "${STATE_DIR}/prev-files/${f}"
    case "$f" in *.sh) mode=755 ;; *) mode=644 ;; esac
    tmp="${TW_DIR}/.${f}.new"
    cp "${SRC_DIR}/${f}" "$tmp" && chmod "$mode" "$tmp" && mv -f "$tmp" "${TW_DIR}/${f}" || return 1
    log "동기화: ${f}"
  done
  return 0
}

write_state() {
  local tmp="${STATE_FILE}.tmp" svc key
  {
    echo "STATUS=$1"
    echo "DEPLOY_SHA=${SHA:-}"
    echo "DEPLOY_SERVICES=\"${TARGETS}\""
    echo "MIGRATED=${MIGRATED}"
    echo "UPDATED_AT=$(date -u +%FT%TZ)"
    for svc in $TARGETS; do
      key=$(tag_key "$svc")
      echo "PREV_${key}=$(prev_of "$svc")"
      echo "NEW_${key}=$(new_of "$svc")"
    done
  } >"$tmp" && mv -f "$tmp" "$STATE_FILE"
}

set_state_status() {
  local tmp="${STATE_FILE}.tmp"
  [ -f "$STATE_FILE" ] || return 0
  awk -v s="$1" '/^STATUS=/ { print "STATUS=" s; next } { print }' "$STATE_FILE" >"$tmp" && mv -f "$tmp" "$STATE_FILE"
}

prev_of() { local n="PREV_$1"; echo "${!n:-}"; }
new_of() { local n="NEW_$1"; echo "${!n:-}"; }

# 서비스 인자 → 정해진 순서(backend → admin → web)로 중복 없이.
normalize_services() {
  local want=" $* " svc out=""
  for svc in $ORDER; do
    case "$want" in *" ${svc} "*) out="${out:+$out }${svc}" ;; esac
  done
  echo "$out"
}

read_current_tags() {
  local svc tag
  for svc in $ORDER; do
    tag=$(read_kv "$ENV_FILE" "$(tag_key "$svc")")
    if [ -n "$tag" ] && ! valid_tag "$tag"; then
      die 1 ".env 의 $(tag_key "$svc")='${tag}' 가 태그 형식이 아니다"
    fi
    printf -v "PREV_${svc}" '%s' "$tag"
  done
}

# 실패한 교체를 이전 태그로 되돌린다. migration 이 돌았으면 되돌리지 않는다.
restore_after_failure() {
  local switched="$1" svc prev ok=1
  if [ "$MIGRATED" = 1 ]; then
    set_state_status failed_after_migration
    log "migration 이 적용된 배포라 자동 롤백하지 않는다 — 이전 backend 이미지는 새 DB revision 으로 기동하지 못한다."
    log "현재 .env 는 새 태그다. 원인을 고쳐 다시 배포하거나, 백업 복원 후 'deploy.sh pin backend <이전 태그>' (README §배포와 롤백)."
    exit 1
  fi
  for svc in $TARGETS; do
    prev=$(prev_of "$svc")
    [ -n "$prev" ] && { set_env_tag "$(tag_key "$svc")" "$prev" || ok=0; }
  done
  for svc in $switched; do
    prev=$(prev_of "$svc")
    if [ -z "$prev" ]; then
      log "${svc}: 이전 태그가 없어(첫 배포) 되돌릴 수 없다"
      ok=0
      continue
    fi
    if ensure_image "$svc" "$prev" && switch_one "$svc" "$prev"; then
      append_log rollback "$svc" "$prev" auto-restore
    else
      log "${svc}: 이전 태그 ${prev} 복구도 실패"
      ok=0
    fi
  done
  if [ "$ok" = 1 ]; then
    set_state_status restored
    die 5 "교체 후 검사 실패 — 이전 태그로 복구했다 (${switched})"
  fi
  set_state_status restore_failed
  die 6 "교체 후 검사 실패, 복구도 실패 — 즉시 사람이 확인해야 한다"
}

# deploy·pin 공통 본체. 전역: TARGETS, NEW_<svc>, SHA, MIGRATE, ACTION, DO_SYNC
run_switch() {
  local svc tag ref expected switched=""
  MIGRATED=0
  disk_gate
  read_current_tags

  # 1) 이미지 준비 — 여기서 실패하면 아무것도 바뀌지 않았다.
  for svc in $TARGETS; do
    ensure_image "$svc" "$(new_of "$svc")" "${SHA:-}" \
      || die 1 "${svc} 이미지 $(image_ref "$svc" "$(new_of "$svc")") 를 준비하지 못했다 (.env 는 그대로)"
  done

  # 2) 마이그레이션 게이트
  local need_migrate=0
  case " $TARGETS " in
    *" backend "*)
      ref=$(image_ref backend "$(new_of backend)")
      expected=$(image_head "$ref")
      [ -n "$expected" ] || die 1 "${ref} 에서 ALEMBIC_EXPECTED_HEAD 를 읽지 못했다"
      read_db_head || die 1 "DB alembic_version 을 읽지 못했다 — postgres 상태 확인"
      if [ "$DB_HEAD" != "$expected" ]; then
        echo "MIGRATION_REQUIRED db=${DB_HEAD:-none} image=${expected}"
        if [ "$MIGRATE" != 1 ]; then
          log "마이그레이션 필요: DB '${DB_HEAD:-none}' → 이미지 '${expected}'. 아무것도 바꾸지 않았다."
          if [ "$DO_SYNC" = 1 ]; then
            log "승인하려면 --migrate (Actions: production-migrate 승인, 비상: MIGRATE=1 make deploy-backend)."
          else
            log "pin 은 migration 을 하지 않는다 — DB 와 head 가 다른 이미지로 되돌리면 기동 때 실패한다(README §배포와 롤백)."
          fi
          exit 3
        fi
        need_migrate=1
      fi
      ;;
  esac

  # 3) VM 파일 동기화 (deploy 만)
  if [ "$DO_SYNC" = 1 ]; then
    sync_files || die 1 "VM 파일 동기화 실패 (서비스는 그대로)"
    mkdir -p "$STATE_DIR" && echo "$SHA" >"${STATE_DIR}/synced-sha"
    # 이미지 이름이 GHCR 로 바뀐 직후에도 교체 대상이 아닌 서비스가 재생성될 수 있게 현재 태그 이미지를 맞춰 둔다.
    for svc in $ORDER; do
      case " $TARGETS " in *" ${svc} "*) continue ;; esac
      tag=$(prev_of "$svc")
      [ -n "$tag" ] && { ensure_image "$svc" "$tag" || log "⚠️  ${svc}:${tag} 이미지를 새 이름으로 맞추지 못했다 (교체 대상 아님)"; }
    done
  fi

  # 4) 승인된 migration — 백업 → 새 이미지로 upgrade → head 재확인
  if [ "$need_migrate" = 1 ]; then
    log "migration 전 백업: ${BACKUP_SCRIPT}"
    bash "$BACKUP_SCRIPT" >&2 || die 1 "백업 실패 — migration 하지 않았다"
    MIGRATED=1
    sudo env "BACKEND_TAG=$(new_of backend)" docker compose --env-file .env run --rm --no-deps backend alembic upgrade head >&2 \
      || die 1 "alembic upgrade 실패 — 서비스는 교체하지 않았다. DB 상태를 확인하고 필요하면 방금 백업으로 복원한다"
    read_db_head && [ "$DB_HEAD" = "$expected" ] \
      || die 1 "migration 후 DB head '${DB_HEAD}' ≠ 기대 '${expected}' — 서비스는 교체하지 않았다"
    log "migration 완료: ${expected}"
  fi

  # 5) 이전 태그 저장 → .env 기록
  mkdir -p "$STATE_DIR" || die 1 "상태 디렉토리를 만들지 못했다"
  write_state switching || die 1 "상태 파일을 쓰지 못했다"
  for svc in $TARGETS; do
    set_env_tag "$(tag_key "$svc")" "$(new_of "$svc")" || die 1 ".env 갱신 실패"
  done

  # 6) 교체 — backend → admin → web
  for svc in $TARGETS; do
    switched="${switched:+$switched }${svc}"
    switch_one "$svc" "$(new_of "$svc")" || restore_after_failure "$switched"
  done

  set_state_status deployed
  for svc in $TARGETS; do append_log "$ACTION" "$svc" "$(new_of "$svc")" "$DEPLOY_MODE"; done
  log "✅ ${ACTION} 완료: $(for svc in $TARGETS; do printf '%s=%s ' "$svc" "$(new_of "$svc")"; done)"
  bash "${TW_DIR}/prune-images.sh" >&2 || log "⚠️  이미지 GC 실패 — 배포는 성공"
  return 0
}

cmd_status() {
  local svc
  for svc in $ORDER; do echo "$(tag_key "$svc")=$(read_kv "$ENV_FILE" "$(tag_key "$svc")")"; done
  echo "SYNCED_SHA=$(cat "${STATE_DIR}/synced-sha" 2>/dev/null)"
  echo "LAST_STATUS=$(read_kv "$STATE_FILE" STATUS)"
}

cmd_rollback() {
  local status services svc key prev new cur switched=""
  take_lock
  status=$(read_kv "$STATE_FILE" STATUS)
  [ "$status" = deployed ] || die 1 "되돌릴 배포가 없다 (마지막 상태: ${status:-없음})"
  services=$(grep -s '^DEPLOY_SERVICES=' "$STATE_FILE" | cut -d= -f2- | tr -d '"')
  services=$(normalize_services "$services")
  [ -n "$services" ] || die 1 "상태 파일에 서비스 목록이 없다"
  if [ "$(read_kv "$STATE_FILE" MIGRATED)" = 1 ]; then
    die 1 "migration 이 적용된 배포는 자동 롤백하지 않는다 — README §배포와 롤백의 수동 절차를 따른다"
  fi
  for svc in $services; do
    key=$(tag_key "$svc")
    prev=$(read_kv "$STATE_FILE" "PREV_${key}")
    new=$(read_kv "$STATE_FILE" "NEW_${key}")
    cur=$(read_kv "$ENV_FILE" "$key")
    valid_tag "$prev" || die 1 "${svc}: 이전 태그가 없다 (첫 배포는 되돌릴 수 없다)"
    [ "$cur" = "$new" ] || die 1 "${svc}: 배포 이후 태그가 바뀌었다 (현재 ${cur}, 배포 ${new}) — 자동 롤백 중단"
    ensure_image "$svc" "$prev" || die 1 "${svc}: 이전 이미지 ${prev} 를 준비하지 못했다 (아무것도 바꾸지 않았다)"
    printf -v "PREV_${svc}" '%s' "$prev"
  done
  case " $services " in
    *" backend "*)
      read_db_head || die 1 "DB alembic_version 을 읽지 못했다"
      [ "$DB_HEAD" = "$(image_head "$(image_ref backend "$(prev_of backend)")")" ] \
        || die 1 "이전 backend 이미지의 alembic head 가 DB '${DB_HEAD}' 와 다르다 — 자동 롤백 중단"
      ;;
  esac
  for svc in $services; do
    set_env_tag "$(tag_key "$svc")" "$(prev_of "$svc")" || die 6 ".env 복원 실패"
  done
  for svc in $services; do
    switched="${switched:+$switched }${svc}"
    switch_one "$svc" "$(prev_of "$svc")" || die 6 "${svc} 롤백 후 검사 실패 — 즉시 사람이 확인해야 한다"
    append_log rollback "$svc" "$(prev_of "$svc")" "$DEPLOY_MODE"
  done
  set_state_status rolled_back
  log "✅ 롤백 완료: ${switched}"
}

usage() {
  echo "사용법: $0 deploy <sha40> <backend|admin|web>... [--migrate] | sync <sha40> | pin <svc> <tag> | rollback | status" >&2
  exit 2
}

main() {
  [ $# -ge 1 ] || usage
  local cmd="$1" arg svc
  shift
  cd "$TW_DIR" 2>/dev/null || die 1 "${TW_DIR} 가 없다"
  [ -r "$ENV_FILE" ] || die 1 "${ENV_FILE} 를 읽을 수 없다"
  SHA="" TARGETS="" MIGRATE=0 DO_SYNC=0 ACTION="${DEPLOY_ACTION:-deploy}"
  case "$cmd" in
    status)
      [ $# -eq 0 ] || usage
      cmd_status
      ;;
    rollback)
      [ $# -eq 0 ] || usage
      cmd_rollback
      ;;
    sync)
      [ $# -eq 1 ] && [[ $1 =~ ^[0-9a-f]{40}$ ]] || usage
      SHA="$1"
      take_lock
      sync_files || die 1 "VM 파일 동기화 실패"
      mkdir -p "$STATE_DIR" && echo "$SHA" >"${STATE_DIR}/synced-sha"
      append_log sync files "${SHA:0:12}" "$DEPLOY_MODE"
      log "✅ 동기화 완료 (${SHA:0:12})"
      ;;
    deploy)
      [ $# -ge 2 ] && [[ $1 =~ ^[0-9a-f]{40}$ ]] || usage
      SHA="$1"
      shift
      for arg in "$@"; do
        case "$arg" in
          backend | admin | web) TARGETS="${TARGETS} ${arg}" ;;
          --migrate) MIGRATE=1 ;;
          *) usage ;;
        esac
      done
      TARGETS=$(normalize_services "$TARGETS")
      [ -n "$TARGETS" ] || usage
      for svc in $TARGETS; do printf -v "NEW_${svc}" '%s' "${SHA:0:12}"; done
      DO_SYNC=1
      take_lock
      run_switch
      ;;
    pin)
      if ! { [ $# -eq 2 ] && tag_key "$1" >/dev/null && valid_tag "$2"; }; then usage; fi
      TARGETS="$1"
      printf -v "NEW_$1" '%s' "$2"
      ACTION="${DEPLOY_ACTION:-rollback}"
      take_lock
      run_switch
      ;;
    *) usage ;;
  esac
}

main "$@"
