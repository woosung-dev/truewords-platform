#!/usr/bin/env bash
# GitHub Actions 배포 접근 준비 — VM 에서 한 번 실행한다(다시 실행해도 같은 결과).
#
#   ssh truewords-oracle 'bash -s' < infra/oracle-vm/install-deploy-access.sh
#   ssh truewords-oracle 'DEPLOY_PUBKEY="ssh-ed25519 AAAA..." bash -s' < infra/oracle-vm/install-deploy-access.sh
#
# 하는 일 (전부 ~/truewords 아래, 다른 스택은 건드리지 않는다)
#   1. ~/truewords/repo — 공개 레포의 blobless clone + sparse 체크아웃(infra/oracle-vm 만).
#      deploy-entry 가 main 조상 검사를 하려면 커밋 이력이 필요해 --depth 1 이 아니다
#      (blob 은 필요한 것만 받으므로 작다).
#   2. ~/truewords/bin/deploy-entry — 강제 명령 진입점 설치(내용이 같으면 그대로).
#   3. authorized_keys 에 넣을 줄을 **출력만** 한다. 키 등록은 사람이 확인하고 직접 한다.
#
# 하지 않는 일: authorized_keys·sshd 설정 변경, .env·compose·이미지·컨테이너 변경, crontab 변경.
#
# 환경 변수
#   TW_REF        체크아웃할 ref (기본 origin/main). 머지 전 리허설이면 브랜치·sha 를 준다.
#   TW_REPO_URL   기본 https://github.com/woosung-dev/truewords-platform.git
#   DEPLOY_PUBKEY 출력할 공개키 한 줄 (없으면 <pub> 자리표시)

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
