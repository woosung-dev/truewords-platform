# Qdrant 셀프 호스팅 (GCP VM + Cloudflare Tunnel)

> **빠른 진입점.** 상세 운영 가이드는 [`docs/07_infra/qdrant-self-hosting.md`](../../docs/07_infra/qdrant-self-hosting.md), 의사결정 배경은 [`docs/dev-log/45-qdrant-self-hosting.md`](../../docs/dev-log/45-qdrant-self-hosting.md) 참조.

## 디렉토리 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | qdrant + cloudflared 두 컨테이너 정의 |
| `.env.example` | 환경 변수 템플릿 (실제 값은 `.env`로 복사 후 채움) |
| `provision.sh` | gcloud로 GCP VM·방화벽 프로비저닝 (로컬에서 실행) |
| `setup-vm.sh` | VM 내부 부트스트랩 (Docker 설치 + compose up) |
| `cloudflared/README.md` | Cloudflare Tunnel 토큰 방식 운영 안내 |

## 아키텍처

```
Cloud Run (FastAPI)
       │ HTTPS
       ▼
Cloudflare Edge ──── 터널(outbound only) ────┐
                                              ▼
                              ┌─────────────────────────────┐
                              │ GCP VM (e2-medium)          │
                              │  ┌────────────────┐         │
                              │  │ cloudflared    │         │
                              │  └────────┬───────┘         │
                              │           ▼ (qdrant_net)    │
                              │  ┌────────────────┐         │
                              │  │ qdrant :6333   │         │
                              │  └────────────────┘         │
                              │  Volume: /opt/qdrant/data   │
                              └─────────────────────────────┘
                              방화벽: SSH(22) only inbound
```

> 외부 클라이언트는 항상 Cloudflare Edge → 터널 → 컨테이너 경로로 들어온다.
> VM의 6333/6334 포트는 외부에 열지 않는다.

## 사전 요구사항

| 항목 | 비고 |
|---|---|
| GCP 프로젝트 + gcloud CLI 인증 | `gcloud auth login` 완료 |
| Cloudflare 계정 + 보유 도메인 | Tunnel용. 도메인은 Cloudflare zone 등록 필수 |
| Cloudflare Tunnel 토큰 | Zero Trust → Networks → Connectors 에서 발급 |
| Qdrant API key | `openssl rand -base64 32` 로 생성 |

## Quickstart (5단계)

### 1. Cloudflare Tunnel 생성 (1회)
1. Cloudflare → Zero Trust → **Networks → Connectors** → Create a tunnel
2. Connector type: `Cloudflared`, Name: `qdrant-truewords`
3. **토큰 복사** (한 번만 표시됨)
4. Route 단계에서 Public Hostname 등록:
   - Subdomain: `qdrant`
   - Domain: 보유 zone 선택
   - Service Type: `HTTP`, URL: `qdrant:6333`

### 2. `.env` 작성
```bash
cp .env.example .env
# QDRANT_API_KEY 와 CLOUDFLARE_TUNNEL_TOKEN 두 줄 채우기
chmod 600 .env
```

### 3. GCP VM 프로비저닝
```bash
# 프로젝트 루트에서 실행
PROJECT_ID=<your-gcp-project> ./infra/qdrant-vm/provision.sh
```

자동 처리:
- `qdrant-server` VM 생성 (e2-medium, 30GB pd-ssd, asia-northeast3-a)
- 방화벽 `allow-ssh-qdrant-server` 생성 (SSH 22 only)
- Shielded VM 옵션 활성화

### 4. VM 부트스트랩
```bash
# 로컬 → VM 디렉토리 업로드
gcloud compute scp --zone=asia-northeast3-a --recurse \
  ./infra/qdrant-vm qdrant-server:~/qdrant-vm

# VM에서 부트스트랩 실행
gcloud compute ssh qdrant-server --zone=asia-northeast3-a \
  --command='bash ~/qdrant-vm/setup-vm.sh'
```

자동 처리:
- Docker + compose-plugin 설치
- `/opt/qdrant/{data,config}` 생성
- `.env` 권한 600 강화
- `docker compose up -d` (qdrant + cloudflared 기동)

### 5. 검증
```bash
# (a) Cloudflare 대시보드에서 Connectors 상태가 Healthy(초록)로 변화
# (b) 외부에서 직접 호출
curl -H "api-key: $QDRANT_API_KEY" \
  https://qdrant.<your-domain>/collections
# → {"result":{"collections":[]}, "status":"ok", ...}
```

## 일상 운영

```bash
gcloud compute ssh qdrant-server --zone=asia-northeast3-a
cd ~/qdrant-vm

sudo docker compose ps                 # 컨테이너 상태
sudo docker compose logs -f cloudflared # 터널 연결 로그
sudo docker compose logs -f qdrant      # Qdrant 로그
sudo docker compose pull && sudo docker compose up -d   # 업그레이드
```

상세: [`docs/07_infra/qdrant-self-hosting.md`](../../docs/07_infra/qdrant-self-hosting.md)

## 트러블슈팅 핵심

| 증상 | 원인 / 조치 |
|---|---|
| Cloudflare에서 502 | cloudflared 재시작: `sudo docker compose restart cloudflared` |
| `curl ... /collections` 401/403 | API key 불일치. `.env` ↔ 호출자 키 일치 확인 |
| VM SSH 거부 | `gcloud compute config-ssh` 한 번 실행 후 재시도 |
| cloudflared 컨테이너 재시작 반복 | `.env`의 토큰 값 개행/공백/따옴표 확인 |
| Qdrant OOM | `docker-compose.yml` `mem_limit` 상향 + VM 머신 타입 확장 |
| 디스크 풀 | Snapshot 정리 + Persistent Disk 확장 |

## 보안 체크리스트

- [ ] `.env`는 git에 커밋되지 않음 (`git check-ignore .env` 확인)
- [ ] `.env` 권한 600
- [ ] VM 방화벽: SSH(22)만 inbound, 6333/6334 닫힘
- [ ] Qdrant API key는 32바이트 이상 랜덤
- [ ] GitHub Secrets와 VM `.env`의 `QDRANT_API_KEY`는 동일 값
- [ ] Cloudflare Tunnel 토큰은 회전 시 두 곳(VM, GitHub Secrets) 모두 갱신

## AWS 이관 시 변경점

본 디렉토리의 `docker-compose.yml`, `setup-vm.sh`는 **EC2에 그대로 사용 가능**.
변경되는 것은 `provision.sh`만 (`gcloud` → `aws ec2 run-instances` 또는 Terraform).
Cloudflare Tunnel 토큰·라우팅·`QDRANT_URL`/`QDRANT_API_KEY`는 그대로 유지됨.

상세: [`docs/dev-log/45-qdrant-self-hosting.md`](../../docs/dev-log/45-qdrant-self-hosting.md) §AWS 이관 친화성 노트
