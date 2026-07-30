#!/usr/bin/env bash
# Oracle Cloud ARM VM에 Docker, Qdrant 저장소, swap과 Compose를 준비하는 부트스트랩 스크립트.
#
# 전제:
#   - scp로 ~/truewords 디렉토리 업로드 완료
#   - ~/truewords/.env 파일 생성 (.env.example 참고)
#
# 사용:
#   bash ~/truewords/setup-vm.sh
set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
QDRANT_DATA_DIR="/opt/qdrant/data"
QDRANT_CONFIG_DIR="/opt/qdrant/config"
QDRANT_SNAPSHOTS_DIR="/opt/qdrant/snapshots"
POSTGRES_DATA_DIR="/opt/postgres/data"
BACKUP_DIR="/opt/backups"

if [[ ! -f "${TW_DIR}/.env" ]]; then
  echo "ERROR: ${TW_DIR}/.env 가 없습니다. .env.example 참고하여 생성 후 다시 실행하세요." >&2
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
sudo mkdir -p "${QDRANT_DATA_DIR}" "${QDRANT_CONFIG_DIR}" "${QDRANT_SNAPSHOTS_DIR}"
sudo chown -R "$(id -u):$(id -g)" "${QDRANT_DATA_DIR}" "${QDRANT_CONFIG_DIR}" "${QDRANT_SNAPSHOTS_DIR}"

# Postgres bind mount 와 백업 디렉토리. Docker 가 없으면 자동 생성하지만 root 소유로
# 만들어지고 부트스트랩만 읽어서는 어떤 경로가 쓰이는지 알 수 없다. 여기서 명시한다.
#
# 소유권은 건드리지 않는다 — postgres 이미지 entrypoint 가 root 로 시작해
# `chown -R postgres $PGDATA` 후 gosu 로 강등하므로, 호스트 사용자로 chown 하면
# 곧바로 되돌려진다. 실측 확인: /opt/postgres/data 는 UID 70(postgres) drwx------.
sudo mkdir -p "${POSTGRES_DATA_DIR}" "${BACKUP_DIR}"

# 3) 12GB VM의 적재·검색 동시 스파이크를 위한 4GB swapfile 생성
if swapon --show --noheadings | grep -q .; then
  echo "==> Swap already active."
else
  if [[ ! -f /swapfile ]]; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile
  if ! sudo grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  echo "==> 4GB swapfile enabled."
fi

# 4) Docker json-file 로그 로테이션 설정
if [[ -e /etc/docker/daemon.json ]]; then
  echo "WARNING: /etc/docker/daemon.json 이 이미 있어 로그 로테이션 설정을 덮어쓰지 않았습니다." >&2
else
  printf '{\n  "log-driver": "json-file",\n  "log-opts": {"max-size": "10m", "max-file": "3"}\n}\n' | \
    sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
  echo "==> Docker log rotation configured."
fi

# 5) UFW 방화벽 (정의되어 있다면) - 6333/6334는 절대 외부 노출 금지
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 22/tcp
  sudo ufw deny 6333/tcp
  sudo ufw deny 6334/tcp
fi

# 6) .env 권한 강화
chmod 600 "${TW_DIR}/.env"

# 7) docker compose 기동
cd "${TW_DIR}"
if sudo docker image inspect "truewords-backend:$(grep '^BACKEND_TAG=' .env | cut -d= -f2-)" >/dev/null 2>&1; then
  sudo docker compose --env-file .env up -d
else
  echo "==> backend 이미지 전달 전에는 sudo docker compose up -d qdrant cloudflared 로 2개만 먼저 띄웁니다."
  sudo docker compose --env-file .env up -d qdrant cloudflared
fi
sudo docker compose ps

echo ""
echo "✅ Qdrant + cloudflared 컨테이너 기동 완료"
echo ""
echo "확인:"
echo "  sudo docker compose logs -f cloudflared    # 터널 연결 로그"
echo "  sudo docker compose logs -f qdrant         # Qdrant 로그"
echo ""
echo "backend 이미지를 전달한 뒤:"
echo "  sudo docker compose up -d"
