<!-- Oracle Cloud ARM VM 단일 노드의 구성과 일상 운영 절차를 설명하는 문서. -->
# Oracle Cloud ARM VM 셀프 호스팅

TrueWords 운영 스택 전체가 Oracle Cloud ARM VM **한 대**에서 돈다. admin(Next.js), backend(FastAPI), Qdrant, PostgreSQL, Cloudflare Tunnel 다섯 컨테이너다. 외부 의존은 Gemini API 하나뿐이다.

이전 경위와 절차는 [`docs/07_infra/oracle-vm-migration.md`](../../docs/07_infra/oracle-vm-migration.md), 결정 배경은 [ADR](../../docs/dev-log/2026-07-25-gcp-to-oracle-migration.md) 을 참조한다.

## 디렉토리 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | admin, backend, qdrant, postgres, cloudflared 다섯 컨테이너와 공용 네트워크를 정의합니다. |
| `.env.example` | VM 통합 환경 변수 템플릿입니다. VM 의 `~/truewords/.env` 로 복사해 채웁니다. |
| `setup-vm.sh` | Docker 설치, Qdrant 디렉토리, 4GB swap, 로그 로테이션, Compose 기동을 처리합니다. |
| `backup-db.sh` | Postgres 일일 백업 (pg_dump → 무결성 검증 → Object Storage 업로드 → 보관 기간 정리). |
| `restore-drill.sh` | 백업 복구 리허설. 운영 DB 는 읽기만 하고 임시 DB 로 복원해 대조합니다. |
| `refresh-questions.sh` | 봇별 추천 질문 주간 갱신. backend 컨테이너 안에서 실행합니다. |

## 인프라 사양

| 항목 | 값 |
|---|---|
| 인스턴스 | `VM.Standard.A1.Flex` (Always Free 한도와 정확히 일치) |
| CPU / 메모리 | 2 OCPU / 12GB RAM |
| 부트 볼륨 | 100GB |
| 리전 / OS | ap-tokyo-1 / Ubuntu 22.04 aarch64 |
| Oracle Security List | TCP 22만 inbound 허용 |
| 외부 서비스 | Cloudflare Tunnel outbound 연결만 사용 |

## 아키텍처

```text
브라우저 ── Cloudflare Edge ──┬── app.<zone> → admin:3000
                              ├── api.<zone> → backend:8080
                              └── vdb.<zone> → qdrant:6333
                                   │ outbound tunnel
                                   ▼
                    ┌─────────────────────────────────────┐
                    │ Oracle ARM VM                        │
                    │  truewords_net (bridge)              │
                    │  cloudflared ─┬─ admin    :3000      │
                    │               ├─ backend  :8080      │
                    │               └─ qdrant   :6333      │
                    │      admin ──→ backend                │
                    │                  postgres :5432      │
                    │  /opt/qdrant/{data,config,snapshots}  │
                    │  /opt/postgres/data                   │
                    │  /opt/backups (pg_dump 14일)          │
                    └──────────────┬──────────────────────┘
                                   │
                              Gemini API
```

다섯 컨테이너가 같은 `truewords_net` 에 있어 서비스 DNS 이름으로 통신한다. Qdrant 6333 과 Postgres 5432 는 호스트 루프백에만 바인딩되어 덤프·복구·exact count 검증 등 로컬 작업에만 쓰인다. admin 은 호스트 publish 없이 터널에서만 닿는다.

브라우저는 `app.<zone>` 하나만 호출한다. 프론트의 모든 API 호출은 상대 경로이고 Next 서버의 `rewrites` 가 `http://backend:8080` 으로 프록시하므로, API 왕복이 Cloudflare 를 다시 타지 않는다.

### 메모리 배분

| 컨테이너 | `mem_limit` | 근거 |
|---|---|---|
| qdrant | 6g | dense 벡터만 2.57GB (417,579 × 1536 × 4B). sparse + HNSW 포함 |
| backend | 3g | fastembed sparse 모델 + 요청 동시성 |
| postgres | 1g | DB 47MB 로 작음 |
| admin | 768m | Next standalone 서버 (Node 힙) |
| cloudflared | 512m | 터널 프록시 |

합계 11.25g / 12g. 실사용은 훨씬 낮아 문제 없지만 (이전 4컨테이너 기준 2.1GB) limit 총합은 빠듯하다. 4GB swap 이 스파이크를 흡수한다. admin 추가 후 `docker stats` 로 실측해 조정한다.

## Cloudflare Tunnel

Zero Trust 에서 터널 `truewords-oracle` 을 만들고 다음 Public Hostname 을 등록한다. 터널은 **원격 관리형**이라 설정은 대시보드에서만 바뀐다.

| Public Hostname | Service |
|---|---|
| `app.<zone>` | `http://admin:3000` |
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
make deploy-backend                    # 빌드 → entrypoint 검증 → 전송 → 무중단 교체
make deploy-admin                      # admin 도 동일 패턴
make rollback-backend TAG=<이전 sha>   # TAG 명시 필수
make rollback-admin   TAG=<이전 sha>
make oracle-logs                       # compose 로그 follow (최근 100줄)
```

`deploy-backend` 는 이미지에 `alembic` 과 `uvicorn` 바이너리가 실제로 있는지 확인한 뒤에야 전송한다. runtime stage 에 바이너리가 빠져 기동에 실패했던 사고(dev-log 41~42)의 재발 방지 게이트다. 전송은 `docker save | gzip -1 | ssh` 이고 Makefile 이 `pipefail` 을 켜므로 스트림이 잘리면 즉시 실패한다.

`rollback-backend` / `rollback-admin` 은 `TAG` 를 반드시 받는다. 기본값(현재 HEAD)으로 돌면 방금 배포한 태그를 재기록하는 no-op 이 되고, 롤백된 줄 알고 장애가 이어진다. 이전 이미지가 VM 에 남아 있어야 하므로 `sudo docker image ls truewords-backend` (또는 `truewords-admin`) 로 확인한다.

### admin 빌드의 build-arg

`NEXT_PUBLIC_API_URL` 은 `admin/next.config.ts` 의 `rewrites()` 에서만 쓰이고 `src/` 어디에도 없다. **Next 는 `rewrites` 를 `next build` 시점에 `routes-manifest.json` 으로 굽기 때문에 런타임 env 로는 바뀌지 않는다.** 그래서 `deploy-admin` 이 `--build-arg NEXT_PUBLIC_API_URL=http://backend:8080` 으로 넣는다. 값을 바꾸려면 재빌드가 필요하다.

`truewords-platform.vercel.app` 은 Vercel 에 리다이렉트 전용으로 남아 있다. `next.config.ts` 의 `redirects()` 가 **host 조건부**라, 같은 빌드가 Oracle 에서 돌 때는 규칙이 걸리지 않는다 (조건을 빼면 자기 자신으로 무한 리다이렉트한다). 리다이렉트는 main 머지로 Vercel 프로덕션이 재빌드된 뒤 활성화되며, 그전까지는 두 도메인이 각자 정상 동작한다.

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

VM 의 `ubuntu` crontab 에 두 건이 등록돼 있다.

```cron
0  18 * * *   /home/ubuntu/truewords/backup-db.sh        >> /home/ubuntu/truewords-backup.log 2>&1
30 18 * * 0   /home/ubuntu/truewords/refresh-questions.sh >> /home/ubuntu/truewords-cron.log   2>&1
```

추천 질문 갱신은 원래 GitHub Actions 에서 돌았다. **Postgres 가 VM 로컬(127.0.0.1 바인딩)로 옮겨오면서 GitHub runner 가 DB 에 닿을 수 없게 돼** VM cron 으로 내렸다. 워크플로를 그대로 뒀다면 낡은 Neon 연결 문자열로 붙어 아무 효과 없는 성공을 기록했을 것이다.

수동 실행:

```bash
ssh truewords-oracle 'bash ~/truewords/refresh-questions.sh'
# 대상만 확인 (Gemini 호출 0)
ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend \
  python scripts/refresh_suggested_questions.py --dry-run'
```

semantic_cache TTL 정리(`cache-cleanup.yml`)는 Qdrant 를 `vdb.<zone>` HTTPS 로만 호출하므로 GitHub Actions 에 그대로 남아 있다.

---

## 백업

### Postgres — 일일 자동

`backup-db.sh` 가 cron 으로 **매일 03:00 KST (18:00 UTC)** 실행된다.

```cron
0 18 * * * /home/ubuntu/truewords/backup-db.sh >> /home/ubuntu/truewords-backup.log 2>&1
```

| 항목 | 값 |
|---|---|
| 방식 | `pg_dump -Fc` (커스텀 포맷, 자체 압축). 덤프 약 11MB |
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
| admin이 시작하지 않음 | `ADMIN_TAG` 와 `sudo docker image ls truewords-admin` 의 태그를 확인합니다. admin 은 backend healthy 를 기다리므로 backend 부터 봅니다. |
| admin 에서 API 가 404/502 | 빌드 시 `NEXT_PUBLIC_API_URL` 이 `http://backend:8080` 이었는지 확인합니다. rewrites 는 빌드 타임에 구워져 재빌드해야 바뀝니다. |
| 무한 리다이렉트 | `next.config.ts` `redirects()` 의 host 조건이 빠졌는지 확인합니다. |
| backend 가 DB 에 못 붙음 | `sudo docker compose ps postgres` 가 healthy 인지, `.env` 의 `DATABASE_URL` 호스트가 `postgres` 인지 확인합니다. |
| Qdrant OOM | `docker stats` 로 메모리를 확인하고 적재와 대량 검색을 분리합니다. 6GB 제한을 임의로 낮추지 않습니다. |
| VM 디스크가 증가함 | `docker system df` 와 `/opt/qdrant`, `/opt/backups` 용량을 확인하고 오래된 이미지와 snapshot 을 정리합니다. |
| 백업이 안 돎 | `tail ~/truewords-backup.log` 와 `crontab -l` 을 확인합니다. Object Storage 업로드 실패는 경고만 남고 로컬 백업은 정상입니다. |
| 터널이 두 곳으로 연결됨 | 다른 환경이 같은 토큰을 쓰는지 확인하고 `truewords-oracle` 전용 토큰으로 교체합니다. |

## 보안 체크리스트

- [ ] Oracle Security List는 TCP 22만 inbound 허용합니다.
- [ ] Qdrant 6333과 Postgres 5432는 `127.0.0.1`에만 바인딩하고 6334는 외부에 노출하지 않습니다.
- [ ] `.env`는 커밋하지 않고 권한 600을 유지합니다.
- [ ] Qdrant API key는 `openssl rand -base64 32`로 생성합니다.
- [ ] Cloudflare Tunnel은 `truewords-oracle` 전용 토큰만 사용합니다.
- [ ] `ADMIN_JWT_SECRET`은 production 기본값이 아니며 `COOKIE_SECURE=true`입니다.
- [ ] 백업 업로드는 Instance Principal 로 인증하며 VM 에 OCI 개인키를 두지 않습니다.
