#!/usr/bin/env bash
# GitHub Actions 배포 접근 준비 — VM 에서 한 번 실행한다(다시 실행해도 같은 결과).
#
#   ssh truewords-oracle 'bash -s' < infra/oracle-vm/install-deploy-access.sh
#   ssh truewords-oracle 'DEPLOY_PUBKEY="ssh-ed25519 AAAA..." MIGRATE_PUBKEY="ssh-ed25519 CCCC..." OPS_PUBKEY="ssh-ed25519 BBBB..." bash -s' < infra/oracle-vm/install-deploy-access.sh
#
# 하는 일 (전부 ~/truewords 아래, 다른 스택은 건드리지 않는다)
#   1. ~/truewords/repo — 공개 레포의 blobless clone + sparse 체크아웃(infra/oracle-vm 만).
#      deploy-entry 가 main 조상 검사를 하려면 커밋 이력이 필요해 --depth 1 이 아니다
#      (blob 은 필요한 것만 받으므로 작다).
#   2. ~/truewords/bin/deploy-entry — 강제 명령 진입점 설치(내용이 같으면 그대로).
#   3. authorized_keys 에 넣을 줄 세 개(배포 키·migration 키·ops-status 읽기 키)를 **출력만** 한다.
#      키 등록은 사람이 확인하고 직접 한다.
#
# 하지 않는 일: authorized_keys·sshd 설정 변경, .env·compose·이미지·컨테이너 변경, crontab 변경.
#
# 환경 변수
#   TW_REF        체크아웃할 ref (기본 origin/main). 머지 전 리허설이면 브랜치·sha 를 준다.
#   TW_REPO_URL   기본 https://github.com/woosung-dev/truewords-platform.git
#   DEPLOY_PUBKEY 배포 키 공개키 한 줄 (없으면 <pub> 자리표시) — production 환경
#   MIGRATE_PUBKEY migration 키 공개키 한 줄 (없으면 <migrate-pub>) — production-migrate 환경, --migrate 허용
#   OPS_PUBKEY    ops-status 읽기 전용 키 공개키 한 줄 (없으면 <ops-pub> 자리표시)

set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
REPO_DIR="${TW_DIR}/repo"
REPO_URL="${TW_REPO_URL:-https://github.com/woosung-dev/truewords-platform.git}"
REF="${TW_REF:-origin/main}"

step() { echo "==> $*"; }

[ -d "$TW_DIR" ] || { echo "❌ ${TW_DIR} 가 없다 — 운영 VM 이 맞는지 확인" >&2; exit 1; }
[ -f "${TW_DIR}/.env" ] || { echo "❌ ${TW_DIR}/.env 가 없다 — 운영 VM 이 맞는지 확인" >&2; exit 1; }
command -v flock >/dev/null || { echo "❌ flock 이 없다 (util-linux)" >&2; exit 1; }
sudo -n docker version >/dev/null 2>&1 || { echo "❌ 'sudo -n docker' 가 비대화식으로 동작하지 않는다" >&2; exit 1; }
# deploy.sh 는 migration 때 'sudo env BACKEND_TAG=… docker compose' 를 쓴다 — docker 만 허용된 sudoers 면 그때 멈춘다.
sudo -n env true >/dev/null 2>&1 || { echo "❌ 'sudo -n env' 가 비대화식으로 동작하지 않는다" >&2; exit 1; }
command -v setsid >/dev/null || { echo "❌ setsid 가 없다 (util-linux) — ssh 가 끊기면 배포가 중간에 죽는다" >&2; exit 1; }
# logind KillUserProcesses=yes 면 ssh 세션이 끝날 때 세션의 프로세스를 모두 죽인다 — setsid 로 떼어 내도 같다.
# Ubuntu 기본값은 no 다. 바꾸는 것은 시스템 설정이라 여기서는 경고만 한다.
if [ "$(busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager KillUserProcesses 2>/dev/null)" = "b true" ]; then
  echo "⚠️  systemd-logind KillUserProcesses=yes — ssh 가 끊기면 떼어 낸 배포도 죽는다. /etc/systemd/logind.conf 를 확인한다" >&2
fi

step "sparse 체크아웃 ${REPO_DIR}"
if [ ! -d "${REPO_DIR}/.git" ]; then
  git clone --quiet --filter=blob:none --no-checkout "$REPO_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" sparse-checkout init --cone
git -C "$REPO_DIR" sparse-checkout set infra/oracle-vm
git -C "$REPO_DIR" fetch --quiet origin "+refs/heads/*:refs/remotes/origin/*"
git -C "$REPO_DIR" -c advice.detachedHead=false checkout --quiet --detach "$REF"
echo "    HEAD $(git -C "$REPO_DIR" rev-parse HEAD)"

step "진입점 ${TW_DIR}/bin/deploy-entry"
mkdir -p "${TW_DIR}/bin"
SRC="${REPO_DIR}/infra/oracle-vm/deploy-entry.sh"
[ -f "$SRC" ] || { echo "❌ ${SRC} 가 없다 — TW_REF 가 이 파일을 포함하는지 확인" >&2; exit 1; }
if cmp -s "$SRC" "${TW_DIR}/bin/deploy-entry"; then
  echo "    변경 없음"
else
  install -m 755 "$SRC" "${TW_DIR}/bin/deploy-entry"
  echo "    설치함 (sha256 $(sha256sum "${TW_DIR}/bin/deploy-entry" | cut -c1-16))"
fi

step "점검: 진입점이 status 를 낸다"
SSH_ORIGINAL_COMMAND=status "${TW_DIR}/bin/deploy-entry"
step "점검: 허용되지 않은 명령은 거부된다 (종료 2 기대)"
set +e
SSH_ORIGINAL_COMMAND='status; id' "${TW_DIR}/bin/deploy-entry" 2>/dev/null
rc=$?
set -e
[ "$rc" = 2 ] || { echo "❌ 거부 검사 실패 (종료 ${rc})" >&2; exit 1; }
echo "    거부됨 (2)"

step "authorized_keys 에 추가할 줄 (자동으로 넣지 않는다 — 확인 후 ~/.ssh/authorized_keys 에 직접 추가)"
# 공개키의 주석은 버리고 "형식 키" 두 칸만 쓴다 — 주석은 아래 고정값으로 붙인다.
read -r KEY_TYPE KEY_BODY _ <<<"${DEPLOY_PUBKEY:-ssh-ed25519 <pub>}"
echo "restrict,command=\"${TW_DIR}/bin/deploy-entry\" ${KEY_TYPE} ${KEY_BODY} truewords-deploy@github-actions"
# migration 키 — production-migrate 환경에만 둔다. 이 키만 --migrate 를 쓸 수 있다.
read -r MIG_KEY_TYPE MIG_KEY_BODY _ <<<"${MIGRATE_PUBKEY:-ssh-ed25519 <migrate-pub>}"
echo "restrict,command=\"env TW_ALLOW_MIGRATE=1 ${TW_DIR}/bin/deploy-entry\" ${MIG_KEY_TYPE} ${MIG_KEY_BODY} truewords-deploy-migrate@github-actions"
# ops-alert.yml 용 읽기 전용 키 — 클라이언트가 무엇을 보내든 ops-status 만 실행된다.
read -r OPS_KEY_TYPE OPS_KEY_BODY _ <<<"${OPS_PUBKEY:-ssh-ed25519 <ops-pub>}"
echo "restrict,command=\"env SSH_ORIGINAL_COMMAND=ops-status ${TW_DIR}/bin/deploy-entry\" ${OPS_KEY_TYPE} ${OPS_KEY_BODY} truewords-ops-read@github-actions"
