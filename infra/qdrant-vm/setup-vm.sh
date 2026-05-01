#!/usr/bin/env bash
# VM 내부 부트스트랩 스크립트 (SSH 접속 후 실행)
#
# 전제:
#   - gcloud compute scp 로 ~/qdrant-vm 디렉토리 업로드 완료
#   - ~/qdrant-vm/.env 파일 생성 (.env.example 참고)
#       QDRANT_API_KEY=<32바이트 랜덤>
#       CLOUDFLARE_TUNNEL_TOKEN=<Cloudflare Zero Trust 발급>
#
# 사용:
#   bash ~/qdrant-vm/setup-vm.sh
set -euo pipefail

QDRANT_VM_DIR="${QDRANT_VM_DIR:-${HOME}/qdrant-vm}"
QDRANT_DATA_DIR="/opt/qdrant/data"
QDRANT_CONFIG_DIR="/opt/qdrant/config"

if [[ ! -f "${QDRANT_VM_DIR}/.env" ]]; then
  echo "ERROR: ${QDRANT_VM_DIR}/.env 가 없습니다. .env.example 참고하여 생성 후 다시 실행하세요." >&2
  exit 1
fi

# 1) Docker + compose plugin 설치 (이미 설치돼 있으면 스킵)
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$(whoami)" || true
  echo "==> Docker installed. (재로그인하여 docker 그룹 적용 필요)"
else
  echo "==> Docker already installed."
fi

# 2) 데이터 디렉토리 생성
sudo mkdir -p "${QDRANT_DATA_DIR}" "${QDRANT_CONFIG_DIR}"
sudo chown -R "$(id -u):$(id -g)" "${QDRANT_DATA_DIR}" "${QDRANT_CONFIG_DIR}"

# 3) UFW 방화벽 (정의되어 있다면) - 6333/6334는 절대 외부 노출 금지
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 22/tcp
  sudo ufw deny 6333/tcp
  sudo ufw deny 6334/tcp
fi

# 4) .env 권한 강화
chmod 600 "${QDRANT_VM_DIR}/.env"

# 5) docker compose 기동
cd "${QDRANT_VM_DIR}"
sudo docker compose --env-file .env up -d
sudo docker compose ps

echo ""
echo "✅ Qdrant + cloudflared 컨테이너 기동 완료"
echo ""
echo "확인:"
echo "  sudo docker compose logs -f cloudflared    # 터널 연결 로그"
echo "  sudo docker compose logs -f qdrant         # Qdrant 로그"
echo ""
echo "외부 검증 (로컬 PC에서):"
echo "  curl -H 'api-key: <QDRANT_API_KEY>' https://qdrant.<your-cf-zone>/collections"
