<!-- Oracle Cloud ARM VM 단일 노드 이전과 운영 절차를 설명하는 문서. -->
# Oracle Cloud ARM VM 셀프 호스팅

GCP Cloud Run 백엔드와 GCP VM Qdrant를 Oracle Cloud ARM VM 한 대로 이전한다. PostgreSQL은 Neon, Admin Dashboard는 Vercel을 계속 사용한다.

## 디렉토리 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | backend, qdrant, cloudflared 세 컨테이너와 공용 네트워크를 정의합니다. |
| `.env.example` | VM 통합 환경 변수 템플릿입니다. |
| `setup-vm.sh` | Docker 설치, Qdrant 디렉토리, 4GB swap, 로그 로테이션, Compose 기동을 처리합니다. |

`provision.sh`는 복사하지 않는다. Oracle VM 생성은 콘솔에서 처리하며 GCP 전용 `gcloud` 프로비저닝은 이 이전에 사용하지 않는다.

## 인프라 사양

| 항목 | 값 |
|---|---|
| 인스턴스 | `VM.Standard.A1.Flex` |
| CPU / 메모리 | 2 OCPU / 12GB RAM |
| 부트 볼륨 | 100GB |
| OS | Ubuntu 22.04 aarch64 |
| Oracle Security List | TCP 22만 inbound 허용 |
| 외부 서비스 | Cloudflare Tunnel outbound 연결만 사용 |

## 아키텍처

```text
Admin Dashboard (Vercel) ─────────────────────┐
                                               │ HTTPS
사용자 ── Cloudflare Edge ─────────────────────┼── api.<zone> → backend:8080
                         truewords-oracle     └── vdb.<zone> → qdrant:6333
                                  │ outbound tunnel
                                  ▼
                    ┌──────────────────────────────────┐
                    │ Oracle ARM VM                     │
                    │  truewords_net (bridge)           │
                    │  cloudflared ─┬─ backend :8080    │
                    │               └─ qdrant  :6333    │
                    │  /opt/qdrant/{data,config,snapshots} │
                    └──────────────┬───────────────────┘
                                   │
                    Neon PostgreSQL / Gemini API
```

`cloudflared`와 `backend`, `qdrant`는 같은 `truewords_net`에 있어 서비스 DNS 이름으로 통신한다. Qdrant의 6333은 호스트 루프백에만 바인딩되어 snapshot recover와 exact count 검증에만 사용한다.

## Cloudflare Tunnel

Zero Trust에서 새 터널 `truewords-oracle`을 만들고 다음 Public Hostname을 등록한다.

| Public Hostname | Service |
|---|---|
| `api.<zone>` | `http://backend:8080` |
| `vdb.<zone>` | `http://qdrant:6333` |

기존 GCP Tunnel 토큰을 재사용하면 안 된다. 같은 터널에 GCP와 Oracle 커넥터가 동시에 연결되면 Cloudflare가 요청을 두 서버로 임의 분산해 데이터와 배포 상태가 갈리는 split-brain이 발생한다.

## Quickstart

### 1. 새 터널을 만든다.

1. Cloudflare Zero Trust → Networks → Tunnels에서 `truewords-oracle`을 생성한다.
2. 토큰을 복사하고 `api.<zone>`과 `vdb.<zone>` Public Hostname을 위 표와 같이 연결한다.
3. 기존 GCP Tunnel과 이름 또는 토큰을 공유하지 않는다.

### 2. VM으로 디렉토리를 전송한다.

```bash
ssh <oracle-user>@<oracle-vm> 'mkdir -p ~/truewords'
scp -r ./infra/oracle-vm/. <oracle-user>@<oracle-vm>:~/truewords/
```

### 3. VM에서 `.env`를 작성한다.

```bash
ssh <oracle-user>@<oracle-vm>
cd ~/truewords
cp .env.example .env
chmod 600 .env
```

`.env`에 새 `QDRANT_API_KEY`, 새 `CLOUDFLARE_TUNNEL_TOKEN`, 기존 Neon·Gemini·Admin 운영 값을 채운다. `ENVIRONMENT=production`에서는 `ADMIN_JWT_SECRET` 변경과 `COOKIE_SECURE=true`가 필수다.

### 4. VM을 부트스트랩한다.

```bash
bash ~/truewords/setup-vm.sh
```

이 스크립트는 ARM Ubuntu에 맞는 Docker CE를 설치하고 `/opt/qdrant/{data,config,snapshots}`, 4GB swapfile, Docker 로그 로테이션을 준비한다.

### 5. Qdrant와 Cloudflare Tunnel을 먼저 기동한다.

백엔드 이미지를 아직 전달하지 않았다면 다음 두 서비스만 기동한다.

```bash
cd ~/truewords
sudo docker compose --env-file .env up -d qdrant cloudflared
```

Cloudflare 대시보드에서 `truewords-oracle` 커넥터가 Healthy인지 확인한다.

### 6. Qdrant 데이터를 이전하고 exact count를 검증한다.

GCP Qdrant에서 컬렉션 snapshot을 생성하여 Oracle VM에 복구한다. snapshot 전송과 복구가 끝나면 source와 target에서 아래 exact count가 일치하는지 확인한다.

```bash
cd ~/truewords
set -a
. ./.env
set +a
curl -sS -X POST \
  -H "api-key: ${QDRANT_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"exact":true}' \
  http://127.0.0.1:6333/collections/${COLLECTION_NAME}/points/count
```

응답의 `result.count`가 기준이다. 컬렉션 정보의 `points_count`는 approximate 값이므로 이전 검증에 사용하지 않는다.

### 7. backend 이미지를 전달하고 전체 서비스를 기동한다.

로컬 Mac에서 ARM64 이미지를 빌드한 뒤 Docker save/load로 VM에 전달한다.

```bash
# 로컬 Mac
docker save truewords-backend:$(git rev-parse --short HEAD) | \
  ssh <oracle-user>@<oracle-vm> 'docker load'

# Oracle VM
cd ~/truewords
sudo docker compose --env-file .env up -d
```

`BACKEND_TAG`는 전달한 이미지 태그와 같아야 한다. `make deploy-backend`가 이 값을 자동 갱신한다.

## 일상 운영

```bash
cd ~/truewords
sudo docker compose ps
sudo docker compose logs -f backend
sudo docker compose logs -f qdrant
sudo docker compose logs -f cloudflared
sudo docker stats
```

컬렉션 이전이나 적재 후에는 `POST /collections/<c>/points/count`에 `{"exact":true}` 본문을 보내 `result.count`를 확인한다. `points_count`는 approximate 값이라 신뢰하지 않는다.

## 백업

Qdrant snapshot은 수동으로 아래 API에서 생성한다. 생성된 파일은 보관 정책에 따라 `/opt/qdrant/snapshots`에 별도 복사해 VM 외부 저장소에도 보관한다.

```bash
cd ~/truewords
set -a
. ./.env
set +a
curl -sS -X POST \
  -H "api-key: ${QDRANT_API_KEY}" \
  http://127.0.0.1:6333/collections/${COLLECTION_NAME}/snapshots
```

수동 생성 경로는 `POST /collections/<collection>/snapshots`다. 응답의 snapshot 이름을 기록하고 복구 전후 exact count를 다시 확인한다.

## 트러블슈팅

| 증상 | 확인 및 조치 |
|---|---|
| Cloudflare 502 | `sudo docker compose logs -f cloudflared backend`로 터널과 backend 헬스체크를 확인합니다. |
| backend가 시작하지 않음 | `BACKEND_TAG`와 `docker image ls truewords-backend`의 태그가 같은지 확인합니다. |
| Qdrant OOM | `docker stats`로 메모리를 확인하고 적재와 대량 검색을 분리합니다. 6GB 제한을 임의로 낮추지 않습니다. |
| VM 디스크가 증가함 | `docker system df`와 `/opt/qdrant` 용량을 확인하고 불필요한 이미지와 오래된 snapshot을 정리합니다. |
| 터널이 두 곳으로 연결됨 | 기존 GCP와 새 Oracle이 같은 토큰을 쓰는지 확인하고 Oracle 전용 `truewords-oracle` 토큰으로 교체합니다. |

## 보안 체크리스트

- [ ] Oracle Security List는 TCP 22만 inbound 허용합니다.
- [ ] Qdrant 6333은 `127.0.0.1`에만 바인딩하고 6334는 외부에 노출하지 않습니다.
- [ ] `.env`는 커밋하지 않고 권한 600을 유지합니다.
- [ ] Qdrant API key는 `openssl rand -base64 32`로 GCP와 별도로 생성합니다.
- [ ] Cloudflare Tunnel은 새 `truewords-oracle` 토큰만 사용합니다.
- [ ] `ADMIN_JWT_SECRET`은 production 기본값이 아니며 `COOKIE_SECURE=true`입니다.
