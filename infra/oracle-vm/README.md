<!-- Oracle Cloud ARM VM 단일 노드의 구성과 일상 운영 절차를 설명하는 문서. -->
# Oracle Cloud ARM VM 셀프 호스팅

기존 운영은 Oracle ARM VM **한 대**의 admin(사용자·관리자 통합), backend, Qdrant, PostgreSQL, Cloudflare Tunnel 5컨테이너다. 저장소는 M1~M4 이후 **web을 추가한 6컨테이너 구성**을 준비한다. 아래 새 구성·origin은 **운영 전환 미실행**이며 별도 승인이 필요하다.

[최초 분리 전환·복구 runbook](../../docs/runbooks/monorepo-migration-and-rollback.md)을 먼저 따른다. 최초 전환 실패 시 이전 web 이미지가 없으므로 기존 통합 admin 이미지·Compose·Cloudflare 라우팅을 함께 복구한다.

이전 경위와 절차는 [`docs/runbooks/oracle-vm-migration.md`](../../docs/runbooks/oracle-vm-migration.md), 결정 배경은 [ADR](../../docs/adr/2026-07-25-gcp-to-oracle-migration.md) 을 참조한다.

## 디렉토리 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | web, admin, backend, qdrant, postgres, cloudflared 6컨테이너와 기존 공용 네트워크를 정의합니다. 운영 적용 전입니다. |
| `.env.example` | VM 통합 환경 변수 템플릿입니다. VM 의 `~/truewords/.env` 로 복사해 채웁니다. |
| `setup-vm.sh` | Docker 설치, Qdrant 디렉토리, 4GB swap, 로그 로테이션, Compose 기동을 처리합니다. |
| `backup-db.sh` | Postgres 백업 (6시간마다 · pg_dump → 무결성 검증 → Object Storage 업로드 → 보관 기간 정리). |
| `restore-drill.sh` | 백업 복구 리허설. 운영 DB 는 읽기만 하고 임시 DB 로 복원해 대조합니다. |
| `refresh-questions.sh` | 봇별 추천 질문 주간 갱신. backend 컨테이너 안에서 실행합니다. |
| `prune-images.sh` | truewords 이미지 GC. web/admin/backend repo의 최신 3개·실행 중 이미지·명시적 보존 태그를 남깁니다. 최초 전환 전 admin 태그도 보존 대상으로 지정합니다. 빌드 캐시도 `until=168h` 로 정리합니다. |
| `preserve-images.example` | VM `preserve-images.txt`의 형식 예제입니다. 실제 전환 전 통합 admin 태그를 기록하면 배포 자동 GC·주간 cron에서도 보존됩니다. |
| `cache-cleanup.sh` | semantic_cache TTL 만료 point 정리 **수동 진입점**. 스케줄은 `cache-cleanup.yml`(GHA) 이 갖습니다 — cron 에 등록하지 않습니다. |
| `ops-check.sh` | 운영 불변식 점검. 예약 작업이 "돌지 않은" 것까지 결과 기준으로 잡습니다. Gemini 키 생존도 함께 봅니다(§`gemini-key`) — probe 본체는 backend 이미지의 `scripts/gemini_key_probe.py` 라 이 디렉토리에 없습니다. FAIL/WARN 이면 ntfy 푸시를 보냅니다(§전달). |

## 인프라 사양

| 항목 | 값 |
|---|---|
| 인스턴스 | `VM.Standard.A1.Flex` (Always Free 한도와 정확히 일치) |
| CPU / 메모리 | 2 OCPU / 12GB RAM |
| 부트 볼륨 | 100GB |
| 리전 / OS | ap-tokyo-1 / Ubuntu 22.04 aarch64 |
| Oracle Security List | TCP 22만 inbound 허용 |
| 외부 서비스 | Cloudflare Tunnel outbound 연결만 사용 |

## 분리 후 아키텍처 (운영 전환 전)

```text
브라우저 ── Cloudflare Edge ──┬── app.<zone> → web:3000
                              ├── admin.<zone> → admin:3000
                              ├── api.<zone> → backend:8080
                              └── vdb.<zone> → qdrant:6333
                                   │ outbound tunnel
                                   ▼
                    ┌─────────────────────────────────────┐
                    │ Oracle ARM VM                        │
                    │  truewords_net (bridge)              │
                    │  cloudflared ─┬─ web      :3000      │
                    │               ├─ admin    :3000      │
                    │               ├─ backend  :8080      │
                    │               └─ qdrant   :6333      │
                    │ web / admin ─→ backend                │
                    │                  postgres :5432      │
                    │  /opt/qdrant/{data,config,snapshots}  │
                    │  /opt/postgres/data                   │
                    │  /opt/backups (pg_dump 6h·14일)       │
                    └──────────────┬──────────────────────┘
                                   │
                              Gemini API
```

전환 후 여섯 컨테이너가 같은 `truewords_net` 에 있어 서비스 DNS 이름으로 통신한다. Qdrant 6333 과 Postgres 5432 는 호스트 루프백에만 바인딩되어 덤프·복구·exact count 검증 등 로컬 작업에만 쓰인다. web/admin은 호스트 publish 없이 터널에서만 닿는다.

사용자 브라우저는 `app.<zone>`, 관리자는 별도 `admin.<zone>`를 사용한다. 각 앱의 API 호출은 같은 origin 프록시를 통하고 Next rewrite가 `http://backend:8080`으로 전달한다. localhost의 서로 다른 포트는 쿠키 격리 경계가 아니며, 운영의 별도 hostname에서 SSO가 자동 제공된다고 가정하지 않는다.

### 메모리 배분

| 컨테이너 | `mem_limit` | 근거 |
|---|---|---|
| qdrant | 6g | dense 벡터만 2.57GB (417,579 × 1536 × 4B). sparse + HNSW 포함 |
| backend | 3g | fastembed sparse 모델 + 요청 동시성 |
| postgres | 1g | DB 44MB 로 작음 |
| admin | 512m | 분리한 관리자 Next standalone, 실부하 검증 필요 |
| web | 512m | 분리한 사용자 Next standalone, 실부하 검증 필요 |
| cloudflared | 512m | 터널 프록시 |

합계 **11.5g / 12g**로 OS·페이지 캐시 여유가 작다. **새 구성의 대표 채팅·SSE·업로드 동시 부하와 peak 메모리 검증 전 운영 배포하지 않는다.** 과거 4/5컨테이너의 실사용 기록과 4GB swap은 새 구성의 안전성 증거가 아니다.

## Cloudflare Tunnel

운영 전환 승인을 받은 뒤 터널 `truewords-oracle`에 아래 Public Hostname을 반영한다. 기존 운영 `app → admin:3000`과 구성을 먼저 기록하고, 최종 관리자 hostname은 사용자와 확정한다. 터널은 **원격 관리형**이라 설정은 대시보드에서만 바뀐다.

| Public Hostname | Service |
|---|---|
| `app.<zone>` | `http://web:3000` (전환 전에는 `admin:3000`) |
| `admin.<zone>` | `http://admin:3000` (신규, hostname 확정·등록 필요) |
| `api.<zone>` | `http://backend:8080` |
| `vdb.<zone>` | `http://qdrant:6333` |

> 현행 Zero Trust UI 에서는 이 화면이 **Networks → Tunnels & Mesh → `truewords-oracle` → `Published application routes`** 다 (구 "Public Hostnames"). Service Type 은 `HTTP` 여야 한다 — 컨테이너가 평문이라 `HTTPS` 로 두면 502 다. Path 는 비운다. 값을 넣으면 그 경로만 라우팅되어 `/login` 과 정적 자산이 404 가 된다. DNS 레코드(proxied CNAME)는 저장 시 자동 생성된다.

터널 하나에 두 서버의 커넥터가 동시에 붙으면 Cloudflare 가 요청을 임의 분산해 데이터와 배포 상태가 갈리는 split-brain 이 발생한다. 다른 환경의 토큰을 재사용하지 않는다.

---

## 최초 구축

### 1. 터널을 만든다

Cloudflare Zero Trust → Networks → Tunnels 에서 `truewords-oracle` 을 생성하고 토큰을 복사한 뒤 위 표의 Public Hostname 을 연결한다.

### 2. VM 으로 디렉토리를 전송한다

```bash
ssh truewords-oracle 'mkdir -p ~/truewords'
scp -r ./infra/oracle-vm/. truewords-oracle:~/truewords/
```

### 3. VM 에서 `.env` 를 작성한다

```bash
ssh truewords-oracle
cd ~/truewords
cp .env.example .env
chmod 600 .env
```

`ENVIRONMENT=production` 에서는 `ADMIN_JWT_SECRET` 변경과 `COOKIE_SECURE=true` 가 필수다. `POSTGRES_*` 값은 **최초 기동 때만 반영**된다 — 볼륨이 생긴 뒤 바꿔도 DB 는 그대로이니 처음에 확정한다.

### 4. VM 을 부트스트랩한다

```bash
bash ~/truewords/setup-vm.sh
```

ARM Ubuntu 용 Docker CE 설치, `/opt/qdrant/{data,config,snapshots}` 생성, 4GB swapfile, Docker 로그 로테이션을 처리한다.

> `setup-vm.sh` 는 기존 swap 이 조금이라도 있으면 swap 설정 전체를 건너뛴다. 기동 후 `swapon --show` 로 4G 가 실제로 잡혔는지 확인한다.

### 5. Qdrant 와 터널을 먼저 기동한다

backend 이미지를 아직 전달하지 않았다면 두 서비스만 띄운다.

```bash
cd ~/truewords
sudo docker compose --env-file .env up -d qdrant cloudflared
```

Cloudflare 대시보드에서 `truewords-oracle` 커넥터가 Healthy 인지 확인한다.

### 6. 데이터를 이전하고 exact count 를 검증한다

컬렉션 snapshot 을 생성해 VM 에 복구한 뒤, source 와 target 의 exact count 가 일치하는지 확인한다.

```bash
cd ~/truewords
set -a; . ./.env; set +a
curl -sS -X POST \
  -H "api-key: ${QDRANT_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"exact":true}' \
  http://127.0.0.1:6333/collections/${COLLECTION_NAME}/points/count
```

응답의 `result.count` 가 기준이다. 컬렉션 정보의 `points_count` 는 segment 단위 approximate 값이라 검증에 쓰지 않는다.

### 7. backend 이미지를 전달하고 전체를 기동한다

정상 경로는 로컬 Mac 에서 `make deploy-backend` 다. 수동으로 할 때는 Makefile 과 같은 형태를 쓴다.

```bash
# 로컬 Mac
docker save truewords-backend:$(git rev-parse --short HEAD) | gzip -1 | \
  ssh truewords-oracle 'gunzip | sudo docker load'

# Oracle VM
cd ~/truewords
sudo docker compose --env-file .env up -d
```

`BACKEND_TAG` 는 전달한 이미지 태그와 같아야 한다. `make deploy-backend` 가 이 값을 자동 갱신한다.

---

## 배포와 롤백

로컬 Mac(Apple Silicon)이 VM 과 같은 arm64 라 레지스트리 없이 이미지를 직접 밀어 넣는다.

```bash
make deploy-backend                    # 빌드 → entrypoint 검증 → 전송 → compose 교체
make deploy-admin                      # admin 도 동일 패턴
make deploy-web                        # 새 사용자 앱, 운영 승인 후
make rollback-backend TAG=<이전 sha>   # TAG 명시 필수
make rollback-admin   TAG=<이전 sha>
make rollback-web     TAG=<이전 sha>
make oracle-logs                       # compose 로그 follow (최근 100줄)
```

세 `deploy-*` 는 먼저 **`deploy-guard`** 를 통과해야 한다 — HEAD 가 `origin/main` 에 포함돼 있고 작업 트리가 깨끗해야 빌드로 넘어간다. 이미지 태그가 커밋 sha 라서, 브랜치 HEAD 나 더러운 트리로 빌드하면 태그와 내용이 어긋나 "운영에 무엇이 올라가 있나" 를 되짚을 수 없다(2026-08-06 실제 사고). 예외가 필요하면 `FORCE_DEPLOY=1 make deploy-backend` 로 명시하고, 그 사실은 기록에 `forced` 로 남는다. 성공한 배포·롤백은 VM `~/truewords/deploy.log` 에 `UTC시각 deploy|rollback 서비스 태그 guarded|forced|manual` 한 줄씩 쌓인다 — `ssh truewords-oracle 'tail ~/truewords/deploy.log'` 가 최근 배포 이력이다.

`deploy-backend` 는 이미지에 `alembic` 과 `uvicorn` 바이너리가 실제로 있는지 확인한 뒤에야 전송한다. runtime stage 에 바이너리가 빠져 기동에 실패했던 사고(dev-log 41~42)의 재발 방지 게이트다. 전송은 `docker save | gzip -1 | ssh` 이고 Makefile 이 `pipefail` 을 켜므로 스트림이 잘리면 즉시 실패한다.

`rollback-backend` / `rollback-admin` / `rollback-web`은 `TAG` 를 반드시 받는다. 기본값(현재 HEAD)으로 돌면 방금 배포한 태그를 재기록하는 no-op 이 되고, 롤백된 줄 알고 장애가 이어진다. 이전 이미지가 VM 에 남아 있어야 하므로 `sudo docker image ls truewords-backend` (또는 `truewords-admin`·`truewords-web`) 로 확인한다. 최신 3개 보존만으로 원하는 이전 태그가 항상 남는다고 가정하지 않는다. `prune-images.sh` dry-run에서 실행 중 이미지와 명시적 보존 태그를 확인한다. 단일 Compose 교체는 무중단을 보장하지 않는다.

### 전환 전 이미지의 지속 보존

`prune-images.sh`는 `PRESERVE_IMAGES_FILE`에서 이미지 목록을 읽는다. 기본 경로는 `${TW_DIR:-${HOME}/truewords}/preserve-images.txt`이며, 일반 VM 구성에서는 `/home/ubuntu/truewords/preserve-images.txt`다. 별도 사용자/설치 위치로 실행할 때는 이 변수를 명시한다. 비밀 `.env`를 source하지 않는다.

[예제](preserve-images.example)를 참고해 전환 직전 `truewords-admin:<실제 통합앱 태그>`를 **주석 없이 한 줄에 하나씩** 기록한다. 예제 파일은 주석뿐이므로 그대로 복사한 상태에서는 보호할 태그가 없다. 파일을 채운 뒤 실제 이미지 존재와 `DRY_RUN=1 bash ~/truewords/prune-images.sh` 결과를 확인한다. 세부 절차는 [지속 보존 runbook](../../docs/runbooks/monorepo-migration-and-rollback.md#이전-통합-admin-이미지의-지속-보존)을 따른다.

배포 자동 GC와 주간 cron도 같은 지속 파일을 읽으므로 다음 실행에도 전환 전 태그가 보호된다. 일회성 `PRESERVE_IMAGES`만 설정한 뒤 주간 GC에서도 유지된다고 가정하지 않는다. rollback 기간이 끝나기 전 보존 파일의 태그를 제거하지 않는다.

### web/admin 빌드의 build-arg

`NEXT_PUBLIC_API_URL`은 `apps/web/next.config.ts`·`apps/admin/next.config.ts`의 API rewrite 목적지다. **Next 는 `rewrites` 를 `next build` 시점에 `routes-manifest.json` 으로 굽기 때문에 런타임 env 로는 바뀌지 않는다.** 그래서 두 앱의 `deploy-*`가 `--build-arg NEXT_PUBLIC_API_URL=http://backend:8080` 으로 넣는다. 값을 바꾸려면 재빌드가 필요하다. 앱 간 링크의 `NEXT_PUBLIC_WEB_URL`·`NEXT_PUBLIC_ADMIN_URL`도 빌드에 전달하고, API의 `WEB_FRONTEND_URL`·`ADMIN_FRONTEND_URL`은 확정 origin으로 맞춘다.

### 모노레포 이미지와 SSE 검사 (2026-09-05)

ARM web/admin/API 이미지 3개 빌드·로컬 기동과 양 웹 컨테이너 통합 smoke가 통과했다. 격리 fixture 환경이며 운영 전환은 미실행이다. 최신 실행 결과는 [전환 계획 §5](../../docs/plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)를 확인한다.

격리 fixture에서 직접 API와 Docker web의 `Accept-Encoding: identity`는 250ms 간격으로 SSE를 전달했지만, web의 gzip 요청은 784ms에 `done`까지 한꺼번에 전달했다. Next 기본 gzip 압축의 버퍼링으로 확인했고, 대응은 API SSE 응답의 `Cache-Control: no-cache, no-transform`이다. 해당 응답만 압축에서 제외하여 일반 페이지 압축을 유지한다. `X-Accel-Buffering: no`만으로는 Next 압축을 해제하지 못한다.

수정 이미지의 로컬 검증은 루트 `node tooling/checks/smoke-images.mjs`로 실행한다. 이 명령은 이미 실행 중인 격리 smoke 컨테이너·fixture API를 전제로 하며 운영에 실행하지 않는다. 진단 수치·최초 계약 PR의 SSE MIME 오기 정규화 예외는 [검증 runbook](../../docs/runbooks/monorepo-migration-and-rollback.md#이미지sse-검증-기록-2026-09-05)에 기록했다. 원격 Cloudflare 전달·동시 부하 검증은 별도로 수행한다.

### 컷오버 검증 결과 (2026-07-30)

| 검사 | 결과 |
|---|---|
| `app.<zone>` `/login` · `/` · `/history` · `/dashboard` · `/about` | 전부 200 |
| 정적 자산 (`_next/static/**.css`) | 200 |
| rewrite `/api/chatbots` | 200 (실 데이터) |
| rewrite `/admin/auth/me` | 401 (쿠키 없음 — 정상) |
| **SSE 스트리밍** 실제 채팅 1회 | 10초, `chunk` 15 + `sources` 1 + `done` 1 |
| **15MB 업로드** `POST /admin/data-sources/upload` | 401 (프록시 통과 — 413 이면 `proxyClientMaxBodySize` 미적용) |
| `ADMIN_FRONTEND_URL` → `app.<zone>` 교체 후 재기동 | 5컨테이너 healthy, 양쪽 도메인 정상 |
| admin 메모리 | 61.5MiB / 768MiB |

## 일상 운영

```bash
cd ~/truewords
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs -f backend
sudo docker compose --env-file .env logs -f qdrant
sudo docker compose --env-file .env logs -f cloudflared
sudo docker stats
```

컬렉션 이전이나 적재 후에는 `POST /collections/<c>/points/count` 에 `{"exact":true}` 본문을 보내 `result.count` 를 확인한다.

## 정기 작업 (cron)

**VM cron 에는 리소스가 호스트 로컬이라 다른 데서 돌 수 없는 것만 둔다.** 나머지 orchestration 은 GitHub Actions 가 주인이다 — provider 에 묶지 않는다는 정책(`docs/runbooks/ci-cd-pipeline.md`).

```cron
0 0,6,12,18 * * *  /home/ubuntu/truewords/backup-db.sh    >> /home/ubuntu/truewords-backup.log 2>&1
30 18 * * 0   /home/ubuntu/truewords/refresh-questions.sh >> /home/ubuntu/truewords-cron.log   2>&1
45 18 * * *   /home/ubuntu/truewords/ops-check.sh         >> /home/ubuntu/truewords-cron.log   2>&1
15 19 * * 0   /home/ubuntu/truewords/prune-images.sh     >> /home/ubuntu/truewords-cron.log   2>&1
```

| 작업 | 주기 | 왜 VM 이어야 하는가 |
|---|---|---|
| `backup-db.sh` | **6시간마다** (KST 09/15/21/03시) | Postgres 가 `127.0.0.1` 바인딩이라 외부에서 닿을 수 없다 |
| `refresh-questions.sh` | 매주 월 03:30 KST | 같은 이유 (Postgres 필요) |
| `ops-check.sh` | 매일 03:45 KST | **감시자는 감시 대상과 다른 실패 도메인에 있어야 한다.** GHA 가 멈춘 사고에서 유일하게 정상 작동한 게 VM cron 이었다 |
| `prune-images.sh` | 매주 월 04:15 KST | 이미지는 VM 로컬 자원이다. 배포 때마다도 돌지만, 배포가 없는 주에도 빌드 캐시가 쌓이므로 주간 보루를 둔다 |

`cache-cleanup.sh` 는 **cron 에 등록하지 않는다.** 스케줄 주인은 `.github/workflows/cache-cleanup.yml` 이고 (Qdrant 는 HTTPS 라 어디서든 닿는다), VM 쪽 스크립트는 수동 실행 진입점으로만 남긴다. 스케줄러가 둘이면 같은 작업이 두 번 돈다.

> 추천 질문 갱신은 원래 GitHub Actions 에서 돌았다. Postgres 가 VM 로컬로 옮겨오면서 runner 가 DB 에 닿을 수 없게 됐는데 `DATABASE_URL` secret 은 낡은 Neon 값이었다. 워크플로를 그대로 뒀다면 **죽은 DB 에 붙어 "성공"을 기록**했을 것이다. 옮긴 게 아니라 옮길 수밖에 없었다.

수동 실행은 로컬 Mac 의 make target 을 쓴다.

```bash
make ops-check                             # 운영 불변식 점검 (7건)
make gemini-check                          # Gemini 키 생존만 단독 확인
make cron-cache-cleanup ARGS=--dry-run     # 삭제 대상만 확인
make cron-cache-cleanup                    # GHA 가 멈춘 동안 대신 실행
make cron-refresh-questions ARGS=--dry-run # 대상 봇만 확인 (Gemini 호출 0)
make cron-refresh-questions                # 실제 갱신
make restore-drill                         # 백업 복구 리허설
```

로그: `tail ~/truewords-cron.log`, `tail ~/truewords-backup.log`. GHA 쪽 실행 이력은 Actions 탭.

## 운영 불변식 점검 (`ops-check.sh`)

2026-07-24~29 에 `cache-cleanup.yml` 이 5일간 매일 실패했는데 아무도 몰랐다. 조사에서 두 가지가 확인됐다 — GitHub 은 알림을 **만들지 않았고**(`gh api notifications?all=true` 빈 목록), 실패한 run 의 job 은 `steps_count: 0` 이었다. **청구 차단은 job 을 아예 시작하지 않으므로 워크플로 안의 `if: failure()` 알림 스텝으로는 이 사고를 잡을 수 없다.**

그래서 감시를 **다른 실패 도메인**(VM cron)에 두고, "job 이 돌았는가" 대신 **"결과가 기대대로인가"** 를 본다.

| 검사 | 임계 | 잡는 것 |
|---|---|---|
| `backup` | 로컬 최신 덤프 < 8h | `backup-db.sh` 미실행·실패 |
| `backup-remote` | Object Storage 사본 < 8h | 업로드가 조용히 실패 (스크립트가 의도적으로 무시하는 경로) |
| `cache-ttl` | 만료 ≤ 50건 | `cache-cleanup.yml` 미실행 (스케줄러 위치 무관) |
| `suggested-q` | `max(suggested_at)` < 10일 | `refresh-questions.sh` 미실행 |
| `containers` | web/admin/backend/qdrant/postgres 5 healthy + cloudflared up | web 누락을 포함한 6서비스 이상 |
| `disk` | < 70% 주의 / < 80% 임계 | 디스크 포화. 한 달에 25GB 늘던 실측(2026-08-30)에서 80% 는 남은 시간이 3주도 안 됐다. WARN 은 종료코드를 바꾸지 않는다 |
| `gemini-key` | embed + generate 둘 다 HTTP 성공, embed 차원 = 1536 | **유일한 외부 의존 사망** — 키 회수·청구 중단·quota 소진·모델 폐기·차원 변경 |

```bash
make ops-check
# CHECK      VERDICT DETAIL
# backup     OK     8h 전 · truewords-2026-07-29-1800.dump · 11M
# cache-ttl  OK     만료 0건
# gemini-key OK     embed 0.50s·1536d · generate 0.90s·tok in=2/out=9/think=0 · key sha8=… · tier=paid
# ...
# RESULT: OK — 불변식 7건 전부 통과
```

임계값은 env 로 덮어쓸 수 있다 (`BACKUP_MAX_AGE_H` / `REMOTE_MAX_AGE_H` / `EXPIRED_MAX` / `SUGGESTED_MAX_AGE_D` / `DISK_MAX_PCT` / `GEMINI_BUDGET_S` / `GEMINI_EXEC_TIMEOUT_S` / `GEMINI_HOST_TIMEOUT_S`). 결과는 `/opt/ops-status.json` 에도 남는다. `make deploy-backend` / `deploy-admin` / `deploy-web`이 배포 전에 자동 실행하되 **배포를 막지는 않는다** — 백업이 낡았다고 배포를 못 하게 하는 건 인과가 뒤집힌 것이다.

### `gemini-key` — 유일한 외부 의존 감시

`apps/api/scripts/gemini_key_probe.py` 가 컨테이너 안에서 돌며 판정을 내고, `ops-check.sh` 는 `GEMINI_PROBE verdict=… detail=…` 한 줄을 **접두사로** 집는다 (마지막 줄이 아니다 — SDK 로그가 뒤에 붙을 수 있다).

**왜 generateContent 하나로는 부족한가.** 채팅은 semantic cache 히트여도 매 요청 `embed_content` 를 부른다 (Embedding Stage 가 CacheCheck **앞**). 임베딩만 죽어도 채팅은 100% 실패하므로, generate 만 찌르면 **초록인데 챗봇은 죽어 있다.** 그래서 두 surface 를 다 호출하고, **한쪽이 실패해도 나머지를 끝까지 호출한다** — 어느 쪽이 살아 있는지가 원인을 갈라 주기 때문이다(`backup-remote` 와 같은 원칙이라 검사 행은 하나다).

| embed | generate | 진단 |
|---|---|---|
| OK | OK | 정상 |
| FAIL 400 | FAIL 400 | 양쪽 동일 실패 → **키 자체가 무효** (회수·삭제) |
| FAIL 403 | FAIL 403 | 권한·API 비활성·**청구 중단**. `paid` tier 이므로 청구를 먼저 본다 |
| OK | FAIL 404 | **키는 살아 있다.** `MODEL_GENERATE` 가 폐기됐다 |
| FAIL `dim-3072` | OK | **키는 살아 있다.** HTTP 200 인데 차원이 바뀌었다 → Qdrant 가 전부 깨진다 |

**요청에 옵션을 더하지 않는다.** `max_output_tokens` / `thinking_config` 를 넣지 않는다 — gemini-3.5 계열은 `thinking_budget` 대신 `thinking_level` 을 받아 400 이 될 수 있고, 그러면 이 검사가 **정상인 키를 "무효" 로 보고**한다. 경보를 못 믿게 만드는 게 검사가 없는 것보다 나쁘다. 원칙: **probe 요청은 운영이 매일 성공시키는 요청의 부분집합이어야 한다.** 실측 결과 `think=0` 이라 옵션이 애초에 불필요했다.

**상한이 세 층이고 순서가 중요하다.** `python 예산(50s) < 컨테이너 timeout(60s) < 호스트 timeout(75s)`. 안쪽만 분류된 판정을 낼 수 있고, 실제로 일을 멈추는 건 컨테이너 안 `timeout` 이다 — docker 에 exec 를 죽이는 API 가 없어 **바깥 timeout 은 CLI 만 죽이고 컨테이너 안 프로세스는 고아로 남는다.** 그리고 `sudo timeout` 순서여야 한다 (`timeout sudo` 면 비특권 timeout 이 root 자식을 못 죽여 `waitpid` 에 매달린다).

예산 50s 의 근거는 실측 산수다 — `import 2.7s + embed(2×8+2) + generate(2×12+2) = 46.7s`. **컨테이너 안 import 가 2.7s** 이므로 그보다 짧은 예산은 API 호출 전에 터지고, 그 경우를 별도로 진단한다(원인이 다르면 조치도 달라야 한다).

리허설은 env 만으로 전 분기를 재현한다.

```bash
make ops-check                                          # 정상 — 7건 통과
make gemini-check                                       # 키만 단독 확인
ssh truewords-oracle 'GEMINI_BUDGET_S=1 bash ~/truewords/ops-check.sh'   # 예산 초과 (import 단계)
ssh truewords-oracle 'GEMINI_BUDGET_S=3 bash ~/truewords/ops-check.sh'   # 예산 초과 (API 호출 중)
ssh truewords-oracle 'GEMINI_EXEC_TIMEOUT_S=1 GEMINI_HOST_TIMEOUT_S=2 bash ~/truewords/ops-check.sh'  # rc 124
ssh truewords-oracle 'GEMINI_PROBE_SCRIPT=scripts/nope.py bash ~/truewords/ops-check.sh'              # 부트스트랩

# 잘못된 키 — 실제 400. 과금·quota 소모가 없어 운영 키에 영향을 주지 않는다.
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T \
  -e GEMINI_API_KEY=invalid-key-for-drill backend python scripts/gemini_key_probe.py'
```

> 마지막 리허설에서 출력의 `key sha8` 이 정상 실행과 **달라야** 한다. 같으면 `-e` 가 먹지 않은 것이고 **그 리허설은 아무것도 검증하지 않았다.** 지문을 찍는 이유가 이것이다.

**비용 — 실측.** 한 번에 generate 입력 2 / 출력 9 토큰 + embed 입력 약 2 토큰. paid 단가(입력 $0.30, 출력 $2.50, 임베딩 $0.15 / 1M) 기준 **1회 약 $0.0000234**.

| 빈도 | 연간 비용 |
|---|---|
| cron 1회/일 (기본) | **약 $0.0085** (1센트 미만) |
| 배포 포함 5회/일 (과다 가정) | **약 $0.043** |

무시할 수준이다. 429 는 신호이므로 재시도하지 않아(`retry_429=False`) probe 가 quota 를 되풀이 소모하지 않는다.

**커버하지 않는 것**: `generate_content_stream`. 운영 채팅은 스트리밍이지만 스트림만 깨지는 건 SDK 문제이지 키 실패가 아니다.

backend 컨테이너가 비정상이면 이 검사는 `SKIP` 하고 `containers` 에 진단을 양보한다 — 한 원인에 두 진단을 내면 엉뚱한 곳을 뒤진다.

### 전달 — ntfy 푸시 (2026-09-05)

탐지(위 7건)와 별개로 **전달**이 없어 2026-08-07~31 에 `cache-cleanup.yml` 이 25일간 안 돌았는데도(GHA 청구 차단 재발) 아무도 몰랐다. `ops-check.sh` 는 매일 `cache-ttl FAIL` 을 `/opt/ops-status.json` 에 적고 있었다. 그래서 스크립트 마지막에 [ntfy.sh](https://ntfy.sh) 푸시 한 줄을 붙였다.

| 항목 | 값 |
|---|---|
| 채널 | `https://ntfy.sh/$NTFY_TOPIC` — 계정·키 없음. 토픽 이름이 비밀이라 `truewords-$(openssl rand -hex 8)` 같은 값을 쓴다 |
| 설정 | VM `~/truewords/.env` 에 `NTFY_TOPIC=…` 한 줄 + 수신 측 구독(폰 ntfy 앱 또는 웹 `https://ntfy.sh/<topic>`). **앱 없이 받는 방식(healthchecks.io 이메일 등)은 `docs/TODO.md` 전달 채널 항목에서 결정 대기** — `NTFY_TOPIC` 이 비어 있으면 이 블록은 아무것도 하지 않는다 |
| 발송 조건 | FAIL ≥ 1 → priority `high`, WARN 만 있으면 `default`. **OK 는 보내지 않는다** — 매일 오는 초록 알림은 곧 안 읽게 된다 |
| 본문 | OK 가 아닌 행만(이름·판정·DETAIL). 전문은 `/opt/ops-status.json` |
| 실패 시 | 전송 실패는 판정을 바꾸지 않는다. stderr 에 경고만 남고 종료코드는 검사 결과 그대로 |

리허설은 반증 가능하게 한다 — 정상 실행에서는 푸시가 **오지 않아야** 하고, 임계값을 강제로 깨면 **와야** 한다.

```bash
make ops-check                                                        # 정상: 푸시 없음
ssh truewords-oracle 'BACKUP_MAX_AGE_H=0 bash ~/truewords/ops-check.sh'   # backup FAIL 강제 → 폰에 "[truewords] ops-check FAIL x1"
```

> 한계: **cron 자체가 안 돌면 이 방식으로는 모른다.** 스크립트가 실행돼야 푸시가 나간다. "안 돌았음" 까지 잡으려면 dead-man ping(healthchecks.io 류)을 `ops-check.sh`·`backup-db.sh` 끝에 한 줄 더 붙여야 한다 — 별도 과제. 배경: [ADR](../../docs/adr/2026-07-30-silent-scheduled-job-failure.md)

---

## 백업

### Postgres — 6시간마다 자동

`backup-db.sh` 가 cron 으로 **6시간마다 (00/06/12/18 UTC = KST 09/15/21/03시)** 실행된다.

빈도 근거는 실측이다 — 하루치 유실의 실체가 채팅 메시지 약 43건(다른 출처 없는 유일본)이고, 덤프가 1초/11MB 라 4배로 늘려도 로컬 616MB·원격 4GB(무료 20GB)에 그친다. WAL 아카이빙은 채택하지 않았다: 44MB DB 에 복구 절차 복잡도를 얹는 대가가 크고, **아카이버 자체가 또 하나의 조용한 실패 지점**이 된다. 상세: [RPO 실측 ADR](../../docs/adr/2026-07-30-rpo-measurement.md)

```cron
0 0,6,12,18 * * * /home/ubuntu/truewords/backup-db.sh >> /home/ubuntu/truewords-backup.log 2>&1
```

| 항목 | 값 |
|---|---|
| 방식 | `pg_dump -Fc` (커스텀 포맷, 자체 압축). 덤프 약 11MB / 1초 |
| 주기 | **6시간마다** (00/06/12/18 UTC). RPO 6h |
| 무결성 검증 | 덤프 직후 `pg_restore --list` 로 헤더 판독. 실패 시 스크립트 중단 |
| VM 로컬 보관 | `/opt/backups`, 14일 (`RETAIN_DAYS`) |
| 원격 보관 | OCI Object Storage `truewords-backups`, 90일 lifecycle 자동 삭제 |
| 인증 | **Instance Principal** — VM 에 개인키를 두지 않는다 (dynamic group `truewords-vm-dg`) |

업로드가 실패해도 로컬 백업은 남고 경고만 기록한다. 47MB DB 에 WAL 아카이빙은 과하고 복구 절차만 복잡해지므로 전체 덤프를 택했다.

### Qdrant — 수동 snapshot

```bash
cd ~/truewords
set -a; . ./.env; set +a
curl -sS -X POST -H "api-key: ${QDRANT_API_KEY}" \
  http://127.0.0.1:6333/collections/${COLLECTION_NAME}/snapshots
```

응답의 snapshot 이름을 기록하고, 복구 전후 exact count 를 다시 확인한다. 생성된 파일은 `/opt/qdrant/snapshots` 에 있으며 보관 정책에 따라 VM 외부에도 복사한다.

---

## 복구

### 복구 리허설 (정기 검증)

**미검증 백업은 백업이 아니다.** `restore-drill.sh` 는 운영 DB 를 읽기만 하고, 최신 덤프를 임시 DB 로 복원해 대조한 뒤 지운다.

```bash
scp infra/oracle-vm/restore-drill.sh truewords-oracle:~/truewords/
ssh truewords-oracle 'bash ~/truewords/restore-drill.sh'
```

검사 방식이 단순 행 수 비교가 **아니라는** 점이 중요하다. 덤프 시각 이후에도 실사용 트래픽이 계속 들어오므로 행 수는 원래 어긋난다. 대신 백업이 보장해야 할 성질 — *덤프에 담긴 모든 행이 원본과 동일하게 되살아난다* — 을 `(id, 행 전체 JSON)` 집합의 차집합(`복원본 EXCEPT 운영본`)이 0인지로 검사한다. dump 이후 새로 생긴 행은 운영본에만 있으므로 이 방향에서는 잡히지 않는다. 대조는 `dblink` 로 같은 클러스터의 두 DB 를 잇는다.

**2026-07-29 리허설 결과 — PASS**

| 항목 | 값 |
|---|---|
| 대상 덤프 | `truewords-2026-07-29-1441.dump` (11MB) |
| 복원 시간 | 1초, `pg_restore` rc=0 |
| 대조 | 11개 테이블 34,377행 전부 `복원본 EXCEPT 운영본` = 0 |
| alembic head | `a1c9e7d0b2f3` 양쪽 일치 |

### 실제 복구

운영 DB 를 되돌려야 할 때의 절차다. **덤프 시각 이후 데이터가 사라지므로 마지막 수단이다.**

```bash
cd ~/truewords
set -a; . ./.env; set +a

# 1. 유입을 끊는다 — backend 를 내려 쓰기를 멈춘다
sudo docker compose --env-file .env stop backend

# 2. 현재 상태를 먼저 떠둔다 (복구가 잘못됐을 때의 되돌림 지점)
sudo ./backup-db.sh

# 3. 대상 덤프를 컨테이너로 넣고 빈 DB 에 복원한다
sudo docker compose cp /opt/backups/<선택한>.dump postgres:/tmp/restore.dump
sudo docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE ${POSTGRES_DB};" -c "CREATE DATABASE ${POSTGRES_DB};"
sudo docker compose exec -T postgres \
  pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump
sudo docker compose exec -T postgres rm -f /tmp/restore.dump

# 4. 스키마 head 확인 후 기동
sudo docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select version_num from alembic_version;"
sudo docker compose --env-file .env up -d --wait backend
```

3단계에서 `DROP DATABASE` 가 실패하면 남은 연결이 있는 것이다. backend 가 완전히 내려갔는지 `sudo docker compose ps` 로 확인한다.

Object Storage 사본을 쓸 때는 먼저 내려받는다.

```bash
/usr/local/bin/oci os object get --auth instance_principal \
  --bucket-name truewords-backups --name <파일명> --file /opt/backups/<파일명>
```

---

## 트러블슈팅

| 증상 | 확인 및 조치 |
|---|---|
| Cloudflare 502 | `sudo docker compose logs -f cloudflared backend` 로 터널과 backend 헬스체크를 확인합니다. |
| backend가 시작하지 않음 | `BACKEND_TAG` 와 `sudo docker image ls truewords-backend` 의 태그가 같은지 확인합니다. |
| web이 시작하지 않음 | `WEB_TAG`·`truewords-web` 이미지, standalone entrypoint와 backend health를 확인합니다. |
| admin이 시작하지 않음 | `ADMIN_TAG` 와 `sudo docker image ls truewords-admin` 의 태그를 확인합니다. admin 은 backend healthy 를 기다리므로 backend 부터 봅니다. |
| web/admin 에서 API 가 404/502 | 빌드 시 `NEXT_PUBLIC_API_URL` 이 `http://backend:8080` 이었는지 확인합니다. rewrites 는 빌드 타임에 구워져 재빌드해야 바뀝니다. |
| backend 가 DB 에 못 붙음 | `sudo docker compose ps postgres` 가 healthy 인지, `.env` 의 `DATABASE_URL` 호스트가 `postgres` 인지 확인합니다. |
| Qdrant OOM | `docker stats` 로 메모리를 확인하고 적재와 대량 검색을 분리합니다. 6GB 제한을 임의로 낮추지 않습니다. |
| VM 디스크가 증가함 | `make prune-images` (또는 `ssh truewords-oracle 'bash ~/truewords/prune-images.sh'`) 를 돌립니다. **`docker image prune` 은 여기서 무효입니다** — 구버전 이미지가 전부 커밋 sha 태그를 달고 있어 dangling 이 아닙니다. 그래도 부족하면 `/opt/qdrant/snapshots` 와 `/opt/backups` 를 확인합니다. |
| 백업이 안 돎 | `tail ~/truewords-backup.log` 와 `crontab -l` 을 확인합니다. Object Storage 업로드 실패는 경고만 남고 로컬 백업은 정상입니다. |
| 터널이 두 곳으로 연결됨 | 다른 환경이 같은 토큰을 쓰는지 확인하고 `truewords-oracle` 전용 토큰으로 교체합니다. |

## ⚠️ 외부 의존 하나 — Gemini API 키의 소유 프로젝트

서비스의 유일한 외부 의존이다. 그리고 있는 곳이 직관에 어긋난다.

| 항목 | 값 |
|---|---|
| GCP 프로젝트 | **`d-project-497004`** ("D-Project") |
| 계정 | **`jangwooseng97@gmail.com`** |
| 키 이름 | Gemini API Key |

인프라 작업에 쓰던 `jetaime-dev` / `jetaime.jang@gmail.com` 이 **아니다.** `jetaime-dev` 에도 "DEV Gemini API Key" 가 있지만 그건 운영 키가 아니다(해시 대조로 확인).

**이 프로젝트를 지우거나 키를 회수하면 챗봇이 즉시 죽는다.** 이름에 TrueWords 가 없어 "안 쓰는 프로젝트" 로 보이는 것이 위험하다 — 2026-06-04 에 `woosung-dev` 를 그렇게 판단해 지웠다가 Qdrant VM 을 잃었다.

**이제 `ops-check.sh` 의 `gemini-key` 가 매일 이 키를 실제로 찔러 본다.** 키가 죽으면 나머지 검사는 전부 초록이므로(`/health` 도 200) 그 전에는 확인 장치가 아예 없었다. 즉시 확인은 `make gemini-check`. 상세: [운영 불변식 점검 §`gemini-key`](#gemini-key--유일한-외부-의존-감시)

확인 근거와 대조 방법: [GCP·Neon 잔존 리소스 감사](../../docs/archive/engineering/2026-07-30-gcp-neon-residual-audit.md)

## 보안 체크리스트

- [ ] Oracle Security List는 TCP 22만 inbound 허용합니다.
- [ ] Qdrant 6333과 Postgres 5432는 `127.0.0.1`에만 바인딩하고 6334는 외부에 노출하지 않습니다.
- [ ] `.env`는 커밋하지 않고 권한 600을 유지합니다.
- [ ] Qdrant API key는 `openssl rand -base64 32`로 생성합니다.
- [ ] Cloudflare Tunnel은 `truewords-oracle` 전용 토큰만 사용합니다.
- [ ] `ADMIN_JWT_SECRET`은 production 기본값이 아니며 `COOKIE_SECURE=true`입니다.
- [ ] 백업 업로드는 Instance Principal 로 인증하며 VM 에 OCI 개인키를 두지 않습니다.
