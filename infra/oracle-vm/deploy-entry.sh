#!/usr/bin/env bash
# GitHub Actions 배포 키의 강제 명령(forced command) — VM ~/truewords/bin/deploy-entry 로 한 번 설치한다.
#
#   authorized_keys:
#   restrict,command="/home/ubuntu/truewords/bin/deploy-entry" ssh-ed25519 <pub> truewords-deploy@github-actions
#
# ── 신뢰 모델 ────────────────────────────────────────────────────────────────
# 이 키로는 셸을 얻을 수 없다(restrict: pty·포워딩·agent 금지). 클라이언트가 보낸 명령은
# $SSH_ORIGINAL_COMMAND 로만 들어오고, 아래 네 형식 말고는 **어떤 부작용보다도 먼저** 거부한다.
#
#   status | rollback | sync <sha40> | deploy <sha40> <backend|admin|web>... [--migrate]
#
# deploy·sync 는 공개 레포의 **main 에 들어간 커밋만** 받는다. 그 sha 로 sparse 체크아웃
# (~/truewords/repo, infra/oracle-vm 만)을 옮긴 뒤 **그 sha 의** deploy.sh 를 실행한다.
# 즉 배포 로직의 원본은 main 이고, main 은 ruleset(PR + CI Required)으로 보호된다.
# 거꾸로 말하면 main 에 머지되는 커밋은 누구든 VM 에서 ubuntu(+sudo docker) 권한으로 도는
# 코드를 바꿀 수 있다 — 리뷰가 곧 이 경계다. 이 파일 자체는 배포로 갱신되지 않는다
# (바꾸려면 install-deploy-access.sh 를 다시 실행한다). 그래서 이 파일은 짧게 유지한다.
#
# 키가 유출돼도 할 수 있는 일은 "main 의 어떤 커밋으로 배포/동기화/롤백" 뿐이다. 포크·PR
# 커밋은 GitHub 이 sha 로 내려주더라도 main 조상 검사에서 거부된다.
#
# 종료 코드: deploy.sh 의 계약을 그대로 전달한다. 여기서 직접 내는 것은
#   1 체크아웃 실패 · 2 거부된 명령 또는 main 밖의 커밋 · 4 잠금 점유

set -uo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
REPO_DIR="${TW_DIR}/repo"
DEPLOY_SH="${REPO_DIR}/infra/oracle-vm/deploy.sh"
CMD="${SSH_ORIGINAL_COMMAND:-}"

re_status='^status$'
re_rollback='^rollback$'
re_sync='^sync ([0-9a-f]{40})$'
re_deploy='^deploy ([0-9a-f]{40})(( (backend|admin|web))+)( --migrate)?$'

reject() {
  echo "deploy-entry: 거부 — $1" >&2
  exit 2
}

SHA=""
if [[ $CMD =~ $re_status ]]; then
  ACTION=status
elif [[ $CMD =~ $re_rollback ]]; then
  ACTION=rollback
elif [[ $CMD =~ $re_sync ]]; then
  ACTION=sync
  SHA="${BASH_REMATCH[1]}"
elif [[ $CMD =~ $re_deploy ]]; then
  ACTION=deploy
  SHA="${BASH_REMATCH[1]}"
else
  reject "허용되지 않은 명령 (status | rollback | sync <sha40> | deploy <sha40> <svc>... [--migrate])"
fi
# 위 정규식을 통과한 문자열은 [0-9a-z -] 뿐이라 공백 분리가 안전하다.
read -r -a ARGS <<<"$CMD"

if [ "$ACTION" != status ]; then
  exec 9>"${TW_DIR}/.deploy.lock" || exit 1
  flock -n 9 || {
    echo "deploy-entry: 다른 배포가 진행 중이다 (잠금 점유)" >&2
    exit 4
  }
  export TW_DEPLOY_LOCK_HELD=1
fi

if [ -n "$SHA" ]; then
  git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 \
    || { echo "deploy-entry: ${REPO_DIR} 체크아웃이 없다 — install-deploy-access.sh 를 먼저 실행" >&2; exit 1; }
  git -C "$REPO_DIR" fetch --quiet origin "+refs/heads/main:refs/remotes/origin/main" \
    || { echo "deploy-entry: origin main fetch 실패" >&2; exit 1; }
  git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" refs/remotes/origin/main 2>/dev/null \
    || reject "${SHA} 는 origin/main 에 들어간 커밋이 아니다"
  git -C "$REPO_DIR" -c advice.detachedHead=false checkout --quiet --detach "$SHA" \
    || { echo "deploy-entry: ${SHA} 체크아웃 실패" >&2; exit 1; }
  [ "$(git -C "$REPO_DIR" rev-parse HEAD)" = "$SHA" ] \
    || { echo "deploy-entry: 체크아웃 결과가 ${SHA} 가 아니다" >&2; exit 1; }
fi

[ -f "$DEPLOY_SH" ] || { echo "deploy-entry: ${DEPLOY_SH} 가 없다" >&2; exit 1; }
exec env DEPLOY_MODE=auto DEPLOY_ACTION= TW_DIR="$TW_DIR" bash "$DEPLOY_SH" "${ARGS[@]}"
