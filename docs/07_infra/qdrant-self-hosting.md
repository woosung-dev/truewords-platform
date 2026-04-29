# Qdrant 셀프 호스팅 운영 가이드

> 결정 ADR: [`docs/dev-log/45-qdrant-self-hosting.md`](../dev-log/45-qdrant-self-hosting.md)
> 인프라 코드: `infra/qdrant-vm/`

## 아키텍처

```
┌────────────┐     HTTPS      ┌──────────────┐
│ Cloud Run  │ ─────────────▶ │ Cloudflare   │
│ (FastAPI)  │                │ Edge         │
└────────────┘                └──────┬───────┘
                                     │ 터널 (outbound only)
                                     ▼
                       ┌────────────────────────────┐
                       │ GCP VM (e2-medium)         │
                       │ ┌──────────────────────┐   │
                       │ │ cloudflared (docker) │   │
                       │ └──────────┬───────────┘   │
                       │            ▼               │
                       │ ┌──────────────────────┐   │
                       │ │ qdrant (docker)      │   │
                       │ │   :6333 :6334        │   │
                       │ └──────────────────────┘   │
                       │ Volume: /opt/qdrant/data   │
                       └────────────────────────────┘
                       Inbound 방화벽: SSH(22) only
```

## 사전 준비

| 항목 | 비고 |
|---|---|
| GCP 프로젝트 + gcloud CLI 인증 | `gcloud auth login` 완료 상태 |
| Cloudflare 계정 (무료) | Zero Trust → Networks → Tunnels 접근 |
| 32바이트 랜덤 API Key | `openssl rand -base64 32` |

## 최초 배포 절차

### 1. Cloudflare Tunnel 생성
1. Cloudflare → Zero Trust → **Networks → Tunnels** → Create a tunnel
2. Connector: **Cloudflared**, Tunnel name: `qdrant-truewords`
3. 발급된 토큰을 GitHub Secrets `CLOUDFLARE_TUNNEL_TOKEN`로 등록
4. 같은 화면 **Public Hostname** 탭:
   - Subdomain: `qdrant`
   - Domain: 보유 zone (없으면 Cloudflare 무료 zone 사용)
   - Service: `http://qdrant:6333`

### 2. GCP VM 프로비저닝
```bash
cd /Users/woosung/project/agy-project/truewords-platform-qdrant-vm
PROJECT_ID=<your-gcp-project> ./infra/qdrant-vm/provision.sh
```

`provision.sh`는 다음을 수행한다:
- `qdrant-server` VM 생성 (e2-medium, 30GB SSD pd-ssd, asia-northeast3-a)
- 방화벽 규칙 `allow-ssh-qdrant-server` 생성 (SSH 22만 허용; 6333/6334는 닫힘)
- Shielded VM 옵션(secure boot, vTPM, integrity monitoring) 활성화

### 3. VM 부트스트랩
```bash
# 1) 로컬에서 .env 작성
cd infra/qdrant-vm
cp .env.example .env
# QDRANT_API_KEY, CLOUDFLARE_TUNNEL_TOKEN 채우기

# 2) VM에 디렉토리 업로드
gcloud compute scp --zone=asia-northeast3-a --recurse \
  ./infra/qdrant-vm qdrant-server:~/qdrant-vm

# 3) 부트스트랩 실행
gcloud compute ssh qdrant-server --zone=asia-northeast3-a \
  --command='bash ~/qdrant-vm/setup-vm.sh'
```

`setup-vm.sh`는 Docker 설치, `/opt/qdrant/{data,config}` 생성, `.env` 권한 600
적용, `docker compose up -d` 까지 자동 처리한다.

### 4. 컬렉션 생성
```bash
# 로컬 PC에서 (또는 Cloud Run에서)
QDRANT_URL=https://qdrant.<your-cf-zone> \
QDRANT_API_KEY=<vm-api-key> \
  uv run python backend/scripts/create_collection_v2.py
```

### 5. 데이터 마이그레이션
```bash
# 환경변수 (.env 또는 셸)
export QDRANT_CLOUD_URL=https://<cloud-cluster>.cloud.qdrant.io
export QDRANT_CLOUD_API_KEY=<cloud-key>
export QDRANT_VM_URL=https://qdrant.<your-cf-zone>
export QDRANT_VM_API_KEY=<vm-api-key>

# 미리보기
uv run python backend/scripts/migrate_cloud_to_vm.py --dry-run

# 실행 (1GB ≈ 30~60분, 중단 시 재실행으로 자동 재개)
uv run python backend/scripts/migrate_cloud_to_vm.py --execute

# 검증
uv run python backend/scripts/verify_migration.py --sample 20
```

### 6. Cutover (Cloud Run 전환)
1. GitHub Secrets 갱신:
   - `QDRANT_URL` → `https://qdrant.<your-cf-zone>`
   - `QDRANT_API_KEY` → VM API Key
2. main 브랜치에 빈 커밋 또는 deploy 트리거 → Cloud Run 재배포
3. 30분 모니터링 (Cloud Run logs, RAG 응답 latency/품질)
4. **1주일** Qdrant Cloud 보존 (롤백 안전판), 그 후 Cloud 클러스터 종료

### 7. 롤백 (필요 시)
GitHub Secrets 이전 값으로 복원 후 재배포 (5분 내 복구).
`backend/scripts/.migration_state.json`은 그대로 유지하면 다음 시도에서 재개 가능.

## 일상 운영

### 상태 확인
```bash
gcloud compute ssh qdrant-server --zone=asia-northeast3-a
cd ~/qdrant-vm
sudo docker compose ps
sudo docker compose logs -f cloudflared   # 터널 연결
sudo docker compose logs -f qdrant         # Qdrant 로그
```

### 외부 헬스체크
```bash
curl -H "api-key: $QDRANT_API_KEY" \
  https://qdrant.<your-cf-zone>/collections
# → {"result":{"collections":[{"name":"malssum_poc"}, ...]}, "status":"ok"}
```

### 컨테이너 업그레이드
```bash
cd ~/qdrant-vm
sudo docker compose pull
sudo docker compose up -d
```
> Qdrant 메이저 업그레이드 전 Snapshot 백업 권장.

### Snapshot 백업 (수동)
```bash
curl -X POST -H "api-key: $QDRANT_API_KEY" \
  https://qdrant.<your-cf-zone>/collections/malssum_poc/snapshots
# 응답에 snapshot 파일명 → /opt/qdrant/data/collections/<col>/snapshots/ 경로
```
> 자동 백업(cron + gcloud storage cp)은 후속 작업.

### 토큰/키 회전
1. 새 `QDRANT_API_KEY` 또는 `CLOUDFLARE_TUNNEL_TOKEN` 발급
2. VM `~/qdrant-vm/.env` 갱신 → `sudo docker compose up -d`
3. GitHub Secrets 갱신 → Cloud Run 재배포

## 문제 해결

| 증상 | 진단 | 해결 |
|---|---|---|
| Cloud Run에서 401/403 | API Key 불일치 | GitHub Secrets ↔ VM `.env` 동기화 |
| Cloudflare Tunnel 502 | cloudflared 재시작 필요 | `sudo docker compose restart cloudflared` |
| Qdrant OOM | mem_limit 부족 | `docker-compose.yml` `mem_limit` 상향 + VM 머신 타입 확장 |
| 디스크 풀 | `/opt/qdrant/data` 비대화 | Snapshot 정리 + PD 확장 |
| 마이그레이션 중단 | 네트워크 일시 장애 | 동일 명령 재실행 (체크포인트 자동 재개) |

## AWS 이관 시 변경점

본 설계는 AWS Single EC2 또는 App Runner+EC2 패턴으로 **거의 코드 변경 없이**
이관 가능하다.

| 자산 | AWS 이관 시 |
|---|---|
| `infra/qdrant-vm/docker-compose.yml` | EC2에 그대로 배포 |
| `infra/qdrant-vm/setup-vm.sh` | Ubuntu EC2에서 동일 동작 |
| `infra/qdrant-vm/provision.sh` | Terraform AWS provider 또는 `aws ec2 run-instances`로 교체 |
| Cloudflare Tunnel 토큰 | 그대로 사용 (Cloudflare는 클라우드 무관) |
| `QDRANT_URL`/`QDRANT_API_KEY` | 값 변경 없음 (Cloudflare URL 동일) |
