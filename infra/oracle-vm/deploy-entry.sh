#!/usr/bin/env bash
# GitHub Actions 배포 키의 강제 명령(forced command) — VM ~/truewords/bin/deploy-entry 로 한 번 설치한다.
#
#   authorized_keys (키 세 개, 같은 진입점 — install-deploy-access.sh 가 줄을 출력한다):
#   restrict,command="/home/ubuntu/truewords/bin/deploy-entry" ssh-ed25519 <pub> truewords-deploy@github-actions
#   restrict,command="env TW_ALLOW_MIGRATE=1 /home/ubuntu/truewords/bin/deploy-entry" ssh-ed25519 <pub> truewords-deploy-migrate@github-actions
#   restrict,command="env SSH_ORIGINAL_COMMAND=ops-status /home/ubuntu/truewords/bin/deploy-entry" ssh-ed25519 <pub> truewords-ops-read@github-actions
#   - 배포 키(production 환경 secret)로는 --migrate 를 쓸 수 없다. migration 은 production-migrate
#     환경에만 있는 두 번째 키로만 된다 — "스키마 변경 승인" 을 자격증명으로 강제한다.
#   - ops-read 키는 클라이언트가 무엇을 보내든 ops-status 만 실행된다.
#   TW_ALLOW_MIGRATE 는 클라이언트가 보낼 수 없다(sshd PermitUserEnvironment no, AcceptEnv 는 LANG·LC_* 뿐).
#
# ── 신뢰 모델 ────────────────────────────────────────────────────────────────
# 이 키로는 셸을 얻을 수 없다(restrict: pty·포워딩·agent 금지). 클라이언트가 보낸 명령은
# $SSH_ORIGINAL_COMMAND 로만 들어오고, 아래 형식 말고는 **어떤 부작용보다도 먼저** 거부한다.
#
#   status | ops-status | rollback | sync | deploy <sha40> <backend|admin|web>... [--migrate]
#
# ops-status 는 ops-check.sh 가 쓴 /opt/ops-status.json 을 그대로 출력만 한다 — 잠금·체크아웃·
# deploy.sh 를 거치지 않는다(배포 중에도 읽힌다). GitHub 토큰을 VM 에 두지 않고 Actions 가 당겨 간다.
#
# deploy 의 <sha40> 는 공개 레포의 **main 에 들어간 커밋만** 받는다. 그러나 그 sha 는 이미지 태그를
# 고르는 데이터일 뿐이다. rollback·sync·deploy 는 sparse 체크아웃(~/truewords/repo, infra/oracle-vm 만)을
# **최신 origin/main** 으로 옮긴 뒤 그 deploy.sh 를 실행한다 — 옛 sha 로 되돌려도 옛 배포 코드·cron
# 스크립트가 되살아나지 않는다. 배포 로직의 원본은 main 이고, main 은 ruleset(PR + CI Required)으로
# 보호된다. 거꾸로 말하면 main 에 머지되는 커밋은 VM 에서 ubuntu(+sudo docker) 권한으로 도는
# 코드를 바꿀 수 있다 — 리뷰가 곧 이 경계다. 이 파일 자체는 배포로 갱신되지 않는다
# (바꾸려면 install-deploy-access.sh 를 다시 실행한다). 그래서 이 파일은 짧게 유지한다.
#
# ── ssh 가 끊겨도 배포는 끝까지 ─────────────────────────────────────────────
# 바꾸는 명령(rollback·sync·deploy)은 deploy.sh 를 setsid 로 떼어 내 HUP·PIPE 를 무시한 채 돌린다.
# 출력은 ~/truewords/deploy-runs/<시각>-<pid>.log 에 쓰고 여기서 따라 읽어 돌려준다. Actions 실행이
# 취소되거나 연결이 끊겨도 교체·검사·자동 복구는 끝까지 돌고, 결과 코드는 같은 이름의 .rc 에 남는다.
# 배포 잠금(fd 9)은 떼어 낸 프로세스가 끝날 때까지 쥔다.
#
# 종료 코드: deploy.sh 의 계약을 그대로 전달한다. 여기서 직접 내는 것은
#   1 체크아웃·실행 실패 · 2 거부된 명령 또는 main 밖의 커밋 · 4 잠금 점유

set -uo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
REPO_DIR="${TW_DIR}/repo"
DEPLOY_SH="${REPO_DIR}/infra/oracle-vm/deploy.sh"
RUN_DIR="${TW_DIR}/deploy-runs"
CMD="${SSH_ORIGINAL_COMMAND:-}"

re_status='^status$'
re_ops='^ops-status$'
re_rollback='^rollback$'
re_sync='^sync$'
re_deploy='^deploy ([0-9a-f]{40})(( (backend|admin|web))+)( --migrate)?$'

reject() {
  echo "deploy-entry: 거부 — $1" >&2
  exit 2
}
fail() {
  echo "deploy-entry: $1" >&2
  exit 1
}

SHA=""
if [[ $CMD =~ $re_ops ]]; then
  cat -- "${OPS_STATUS_FILE:-/opt/ops-status.json}" \
    || fail "ops-status 파일을 읽지 못했다 (ops-check.sh 가 한 번도 돌지 않았거나 경로 문제)"
  exit 0
elif [[ $CMD =~ $re_status ]]; then
  ACTION=status
elif [[ $CMD =~ $re_rollback ]]; then
  ACTION=rollback
elif [[ $CMD =~ $re_sync ]]; then
  ACTION=sync
elif [[ $CMD =~ $re_deploy ]]; then
  ACTION=deploy
  SHA="${BASH_REMATCH[1]}"
  if [ -n "${BASH_REMATCH[5]}" ] && [ "${TW_ALLOW_MIGRATE:-}" != 1 ]; then
    reject "--migrate 는 migration 전용 키(production-migrate)로만 할 수 있다"
  fi
else
  reject "허용되지 않은 명령 (status | ops-status | rollback | sync | deploy <sha40> <svc>... [--migrate])"
fi
# 위 정규식을 통과한 문자열은 [0-9a-z -] 뿐이라 공백 분리가 안전하다.
read -r -a ARGS <<<"$CMD"

if [ "$ACTION" = status ]; then
  [ -f "$DEPLOY_SH" ] || fail "${DEPLOY_SH} 가 없다 — install-deploy-access.sh 를 먼저 실행"
  exec env DEPLOY_MODE=auto DEPLOY_ACTION= TW_DIR="$TW_DIR" bash "$DEPLOY_SH" status
fi

exec 9>"${TW_DIR}/.deploy.lock" || exit 1
flock -n 9 || {
  echo "deploy-entry: 다른 배포가 진행 중이다 (잠금 점유)" >&2
  exit 4
}

git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || fail "${REPO_DIR} 체크아웃이 없다 — install-deploy-access.sh 를 먼저 실행"
git -C "$REPO_DIR" fetch --quiet origin "+refs/heads/main:refs/remotes/origin/main" \
  || fail "origin main fetch 실패"
if [ -n "$SHA" ]; then
  git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" refs/remotes/origin/main 2>/dev/null \
    || reject "${SHA} 는 origin/main 에 들어간 커밋이 아니다"
fi
MAIN_SHA=$(git -C "$REPO_DIR" rev-parse --verify refs/remotes/origin/main) || fail "origin/main 을 읽지 못했다"
git -C "$REPO_DIR" -c advice.detachedHead=false checkout --quiet --detach "$MAIN_SHA" \
  || fail "${MAIN_SHA} 체크아웃 실패"
[ "$(git -C "$REPO_DIR" rev-parse HEAD)" = "$MAIN_SHA" ] || fail "체크아웃 결과가 ${MAIN_SHA} 가 아니다"
[ -f "$DEPLOY_SH" ] || fail "${DEPLOY_SH} 가 없다"

# ── 떼어 내 실행 ──────────────────────────────────────────────────────────
mkdir -p "$RUN_DIR" || fail "${RUN_DIR} 를 만들지 못했다"
find "$RUN_DIR" -type f -mtime +30 -delete 2>/dev/null
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_LOG="${RUN_DIR}/${RUN_ID}.log"
RUN_RC="${RUN_DIR}/${RUN_ID}.rc"
: >"$RUN_LOG" || fail "${RUN_LOG} 를 쓰지 못했다"
echo "deploy-entry: 실행 기록 ${RUN_LOG} (배포 코드 ${MAIN_SHA:0:12})" >&2

# 무시된 시그널은 자식에게 그대로 물려진다 — 떼어 낸 deploy.sh·docker 가 HUP·PIPE 로 죽지 않는다.
trap '' HUP PIPE
# shellcheck disable=SC2016 # 떼어 낸 bash 가 자기 인자로 확장한다
DETACH='log=$1 rc=$2; shift 2; "$@" </dev/null >>"$log" 2>&1; echo "$?" >"$rc.tmp" && mv -f "$rc.tmp" "$rc"'
RUN=(bash -c "$DETACH" deploy-run "$RUN_LOG" "$RUN_RC"
  env DEPLOY_MODE=auto DEPLOY_ACTION= TW_DIR="$TW_DIR" TW_SRC_SHA="$MAIN_SHA" TW_DEPLOY_LOCK_HELD=1
  bash "$DEPLOY_SH" "${ARGS[@]}")
if command -v setsid >/dev/null 2>&1; then
  setsid -w "${RUN[@]}" &
else
  "${RUN[@]}" &
fi
PID=$!
trap - HUP PIPE
# 잠금은 떼어 낸 프로세스가 쥔다. 여기서 놓아야 이 프로세스가 먼저 죽어도 잠금이 남지 않는다.
exec 9>&-

# 따라 읽기 — 줄 단위로, 끝에 걸린 반쪽 줄도 놓치지 않는다.
exec 3<"$RUN_LOG"
drain() {
  local line=""
  while IFS= read -r line <&3; do printf '%s\n' "$line"; done
  [ -z "$line" ] || printf '%s' "$line"
}
while :; do
  drain
  [ -f "$RUN_RC" ] && break
  if ! kill -0 "$PID" 2>/dev/null; then
    sleep 1
    [ -f "$RUN_RC" ] && break
    drain
    fail "떼어 낸 배포 프로세스가 결과 없이 끝났다 — ${RUN_LOG} 확인"
  fi
  sleep 1
done
drain
RC=$(cat "$RUN_RC")
[[ $RC =~ ^[0-9]+$ ]] || fail "결과 코드를 읽지 못했다 (${RUN_RC})"
exit "$RC"
