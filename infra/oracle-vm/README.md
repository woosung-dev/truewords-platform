<!-- Oracle Cloud ARM VM 단일 노드의 구성과 일상 운영 절차를 설명하는 문서. -->
# Oracle Cloud ARM VM 셀프 호스팅

운영은 Oracle ARM VM **한 대**의 web(사용자)·admin(관리자)·backend·Qdrant·PostgreSQL·Cloudflare Tunnel **6컨테이너**다. 2026-09-06 web/admin 분리 컷오버를 완료했고, 이전 통합 admin 이미지 `truewords-admin:30ca81f` 는 `preserve-images.txt` 로 보존한다(전환 기록: [runbook §실행 기록](../../docs/runbooks/monorepo-migration-and-rollback.md#실행-기록-2026-09-06)).

재배포·롤백은 [분리 전환·복구 runbook](../../docs/runbooks/monorepo-migration-and-rollback.md)을 따른다. 분리 이후 웹 롤백은 `make rollback-web/admin TAG=…`, 통합 구성으로의 복귀는 `truewords-admin:30ca81f` + Cloudflare `app → admin:3000` 을 함께 되돌린다.

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
| `send-hoondok-push.sh` | 훈독 Web Push 발송(PLAN-HD-006). 15분마다 backend 컨테이너 안에서 돌며 발송 창(`read_time` ~ +2h)에 든 사용자에게 보냅니다. VAPID 3값이 `.env` 에 없으면 no-op(exit 0)이라 알림을 켜기 전에 등록해도 무해합니다. |
| `prune-images.sh` | truewords 이미지 GC. web/admin/backend repo의 최신 3개·실행 중 이미지·명시적 보존 태그를 남깁니다. 최초 전환 전 admin 태그도 보존 대상으로 지정합니다. 빌드 캐시도 `until=168h` 로 정리합니다. |
| `preserve-images.example` | VM `preserve-images.txt`의 형식 예제입니다. 실제 전환 전 통합 admin 태그를 기록하면 배포 자동 GC·주간 cron에서도 보존됩니다. |
| `cache-cleanup.sh` | semantic_cache TTL 만료 point 정리 **수동 진입점**. 스케줄은 `cache-cleanup.yml`(GHA) 이 갖습니다 — cron 에 등록하지 않습니다. |
| `ops-check.sh` | 운영 불변식 점검. 예약 작업이 "돌지 않은" 것까지 결과 기준으로 잡습니다. Gemini 키 생존도 함께 봅니다(§`gemini-key`) — probe 본체는 backend 이미지의 `scripts/gemini_key_probe.py` 라 이 디렉토리에 없습니다. 훈독 편성 재고는 §`hoondok-today` 가 WARN 으로 봅니다. FAIL/WARN 이면 ntfy 푸시를 보냅니다(§전달). |
| `deploy.sh` | VM 에서 서비스를 교체하는 **유일한** 코드 경로(이미지 준비 → migration 게이트 → 파일 동기화 → 교체·검사 → 자동 복구·기록). Actions 와 `make deploy-*` 가 함께 씁니다. §배포와 롤백 |
| `deploy-entry.sh` | Actions 배포 키의 강제 명령 진입점. VM `~/truewords/bin/deploy-entry` 로 설치되며 배포로 갱신되지 않습니다 |
| `install-deploy-access.sh` | 배포 접근 준비(VM 의 sparse 체크아웃·진입점 설치). 다시 실행해도 같은 결과이며 `authorized_keys` 는 바꾸지 않습니다 |
| `build-args.env` | web/admin 빌드 인자(공개 값)의 원본. Actions 와 비상 경로가 같은 파일을 읽습니다 |
| `smoke.sh` | 배포 직후 **공개 URL** 스모크. VM 이 아니라 **로컬 또는 Actions 러너에서** 실행합니다(`make smoke-web`, Release 의 검증 단계) — 검사 대상이 Cloudflare 엣지·터널·Next 라우팅을 통과하는 공개 경로 그 자체라 ssh 를 쓰지 않습니다. 절차는 [훈독 PWA 롤아웃 runbook](../../docs/runbooks/hoondok-pwa-rollout.md). |

## 인프라 사양

| 항목 | 값 |
|---|---|
| 인스턴스 | `VM.Standard.A1.Flex` (Always Free 한도와 정확히 일치) |
| CPU / 메모리 | 2 OCPU / 12GB RAM |
| 부트 볼륨 | 100GB |
| 리전 / OS | ap-tokyo-1 / Ubuntu 22.04 aarch64 |
| Oracle Security List | TCP 22만 inbound 허용 |
| 외부 서비스 | Cloudflare Tunnel outbound 연결만 사용 |

## 아키텍처 (2026-09-06 분리 컷오버 이후)

```text
브라우저 ── Cloudflare Edge ──┬── app.<zone> → web:3000
                              ├── truewords-admin.<zone> → admin:3000
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

사용자 브라우저는 `app.<zone>`, 관리자는 별도 `truewords-admin.<zone>`를 사용한다(`DEC-MONO-002`, 2026-09-06 확정. zone 을 다른 프로젝트와 공유하므로 프로젝트 접두어를 붙인다). 각 앱의 API 호출은 같은 origin 프록시를 통하고 Next rewrite가 `http://backend:8080`으로 전달한다. localhost의 서로 다른 포트는 쿠키 격리 경계가 아니며, 운영의 별도 hostname에서 SSO가 자동 제공된다고 가정하지 않는다.

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

실측(2026-09-06 컷오버): VM 은 nexus·kairos·quantbridge 와 공유(22+ 컨테이너). web idle 35~42MiB, 동시 SSE 5건 피크 72MiB; admin 38MiB; backend 500MiB; qdrant 1.0GiB. host available 7.2GB.

## Cloudflare Tunnel

터널 `truewords-oracle` 의 Published application routes 는 아래 표다(2026-09-06 컷오버에서 `app` 을 `web:3000` 으로 전환, `truewords-admin` 신규 등록). 터널은 **원격 관리형**이라 설정은 대시보드에서만 바뀐다.

| Public Hostname | Service |
|---|---|
| `truewords.<zone>` | `http://web:3000` (canonical, 2026-09-06 추가. 구 `app.<zone>` route·DNS 는 같은 날 **삭제** — 실사용자 없어 301 생략) |
| `truewords-admin.<zone>` | `http://admin:3000` (2026-09-06 등록) |
| `api.<zone>` | `http://backend:8080` |
| `vdb.<zone>` | `http://qdrant:6333` |

> 현행 Zero Trust UI 에서는 이 화면이 **Networks → Tunnels & Mesh → `truewords-oracle` → `Published application routes`** 다 (구 "Public Hostnames"). Service Type 은 `HTTP` 여야 한다 — 컨테이너가 평문이라 `HTTPS` 로 두면 502 다. Path 는 비운다. 값을 넣으면 그 경로만 라우팅되어 `/login` 과 정적 자산이 404 가 된다. DNS 레코드(proxied CNAME)는 저장 시 자동 생성된다.

터널 하나에 두 서버의 커넥터가 동시에 붙으면 Cloudflare 가 요청을 임의 분산해 데이터와 배포 상태가 갈리는 split-brain 이 발생한다. 다른 환경의 토큰을 재사용하지 않는다.

### 터널 배치 방식 (2026-09-06 결정: 현행 유지)

이 VM 에는 프로젝트별 cloudflared 컨테이너 4개(터널 4개)가 있다. truewords 의 cloudflared 는 `truewords_net` 에 붙어 **서비스명**(`web:3000`·`admin:3000`·`backend:8080`)으로 라우팅하고 web/admin/backend 는 호스트 포트를 열지 않는다. nexus·kairos·quantbridge 의 cloudflared 는 `network_mode: host` 로 `localhost:<프로젝트별 포트>` 를 가리킨다. Cloudflare 문서는 터널 하나에 hostname 여러 개를 싣는 것을 기본으로 하되 호스트당/앱당 터널 수를 규정하지 않으며, 컨테이너 환경에서는 같은 사용자 정의 네트워크 + 서비스명(zero-port)이 권장 패턴이다. 비교: ① 현행(프로젝트별 터널·격리) ★4 ② 다른 프로젝트도 서비스명 방식으로 ★3(해당 레포를 손볼 때) ③ VM 단일 cloudflared 로 통합 ★2(재시작·오설정이 4프로젝트 동시 장애, 서비스명 충돌) ④ truewords 를 host 모드·localhost 포트로 ★1(포트 공개, 보안 후퇴). 컨테이너 모드에서 `localhost` 는 cloudflared 자신을 가리켜 502 다.

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

Actions 배포를 아직 연결하지 않았다면 로컬 Mac 에서 비상 경로 `make deploy-backend` 로 이미지를 넣는다(§배포와 롤백). 연결 뒤에는 Release 워크플로가 GHCR 에서 받는다. 이미지가 준비되면 VM 에서 전체를 기동한다.

```bash
cd ~/truewords
sudo docker compose --env-file .env up -d
```

`BACKEND_TAG` 는 VM 에 있는 이미지 태그와 같아야 한다. 이후의 교체는 `deploy.sh` 가 이 값을 갱신한다.

---

## 배포와 롤백

정상 경로는 GitHub Actions `release.yml` 이다. main 의 CI 가 성공하면 서비스별 arm64 이미지를 `ghcr.io/woosung-dev/truewords-<svc>:<sha 12자>` 로 올리고, 배포는 강제 명령 SSH 키로 VM 의 `deploy.sh` 를 부른다. `make deploy-*` 는 Actions 를 쓸 수 없을 때의 **비상 경로**이고, 같은 `deploy.sh` 를 rsync 해서 부른다 — 교체 순서·검사·자동 복구·`deploy.log` 규칙은 두 경로가 같다. 결정 배경은 [배포 파이프라인 ADR](../../docs/adr/2026-10-02-gha-deploy-pipeline.md), 동작의 원본은 `deploy.sh` 머리 주석이다.

### 정상 경로 — Actions

1. main 머지 뒤 CI 가 성공하면 Release 가 자동으로 돈다. 그 커밋이 이미지나 VM 파일(`infra/oracle-vm/` 의 `*.md` 제외)을 바꿀 때만 배포 job 이 승인을 요청한다(문서·테스트만 바뀐 머지는 이미지만 만든다). 직전 커밋의 main CI 가 성공하지 않았으면(실패·취소) 밀린 변경이 있을 수 있어 판정 없이 승인을 요청한다. 다른 커밋을 올리거나 다시 돌릴 때는 Actions → **Release** → Run workflow, `sha`(비우면 main 의 HEAD), `deploy=true`. 수동 실행은 그 sha 에 main push 로 돈 `CI` 의 최신 실행이 성공이어야 시작한다(`rollback=true` 는 성공한 실행 하나면 된다. 판정: `tooling/checks/ci-gate.mjs`).
2. `production` 환경 승인. 이미지가 바뀐 서비스만 교체된다(판정: `tooling/checks/deploy-services.mjs`).
3. DB migration 이 필요하면 1차 배포는 아무것도 바꾸지 않고 멈추고, `Deploy with DB migration` job 이 `production-migrate` 승인을 기다린다. 승인하면 백업 → `alembic upgrade head` → 교체 순이다. `--migrate` 는 그 환경에만 있는 migration 전용 키로만 VM 이 받는다. migration 출력 전문은 VM `deploy-state/migrate-*.log` 에만 남고 Actions 로그(공개)에는 끝부분만 나온다.
4. 공개 URL 스모크까지 통과하면 끝. 실패하면 `[deploy-alert]` GitHub Issue 가 열리고(저장소 소유자에게 메일) 다음 성공 배포가 닫는다. `NTFY_TOPIC` secret 이 있으면 ntfy 도 보낸다. 승인 거절·만료는 VM 에 아무것도 하지 않았으므로 이슈를 열지 않는다.

VM 에서는 배포가 ssh 세션과 떨어진 프로세스로 돈다. 연결이 끊기거나 실행을 취소해도 교체·검사·자동 복구는 끝까지 가고, 전체 출력은 `~/truewords/deploy-runs/<시각>-<pid>.log`, 결과 코드는 같은 이름의 `.rc` 에 남는다(30일 뒤 삭제). 알림에 "VM 에서는 계속됐을 수 있다" 가 보이면 그 로그와 `status` 부터 본다.

수동 배포로 되돌릴 때는 `release.yml` deploy job 의 `if:` 에서 `workflow_run` 조건 줄을 지운다. 승인 대기 중인 배포는 하나만 남는다 — 더 새 머지의 배포가 옛 대기를 취소하고, 운영 태그 기준으로 밀린 변경까지 함께 올린다.

| 결과 | 뜻 | 대처 |
|---|---|---|
| `CI 가 아직 끝나지 않았다`·`CI 가 <결론> 로 끝났다`·`CI 실행이 없다` (Resolve commit 단계) | 그 sha 의 main push CI 가 초록이 아니다. 빌드·VM 모두 손대지 않았고 이슈도 열지 않는다 | 진행 중이면 끝난 뒤 다시 실행한다. 실패·취소면 메시지의 실행 URL 에서 원인을 고치거나 재실행해 초록을 만든 뒤 실행한다 |
| `MIGRATION_REQUIRED` (종료 3) | 이미지와 DB 의 alembic head 가 다르다. 아무것도 바꾸지 않았다 | migration 내용을 확인하고 `production-migrate` 를 승인한다 |
| 잠금 점유 (종료 4) | 다른 배포(비상 경로 포함)가 진행 중이다 | 끝난 뒤 다시 실행한다 |
| 검사 실패·복구함 (종료 5) | 교체 후 이미지 ID·healthy·내부 HTTP 검사가 실패해 이전 태그로 되돌렸다 | 이슈의 실행 로그와 `make oracle-logs` 로 원인을 본다 |
| 복구 실패 (종료 6) · migration 뒤 실패 | 운영이 어중간한 상태일 수 있다 | `ssh truewords-oracle 'grep _TAG ~/truewords/.env; tail ~/truewords/deploy.log'` 로 상태를 보고 아래 롤백 절차를 따른다 |
| 후퇴 배포 거부 (Plan 단계) | 운영 태그가 이 sha 의 조상이 아니다 | 의도한 되돌리기면 `rollback=true` 로 다시 실행한다 |
| `VM status 출력에 … 가 없다` (Plan 단계) | VM 상태를 끝까지 읽지 못했다(ssh 실패·잘린 출력) | VM 접속을 확인하고 다시 실행한다. 빈 결과를 첫 배포로 보지 않는다 |
| DB head 가 비었다·여러 개다·이미지가 모른다 (종료 1) | migration 으로 풀 수 없는 DB 상태이거나, DB 가 이미지보다 앞섰다(옛 backend 로 되돌리는 중) | 백업 전에 멈췄다. DB 의 `alembic_version` 을 사람이 확인한다 |
| 배포 뒤 상태를 읽지 못함 | 교체는 끝났을 수 있지만 검증 직전 ssh 가 끊겼다 | 자동 롤백하지 않았다. `status` 와 공개 URL 을 직접 확인한다 |
| 결과를 알 수 없다 (종료 7, 128 이상) | VM 의 실행이 결과 코드 없이 끝났거나 시그널로 죽었다. 교체가 일부 됐을 수 있다 | `deploy-runs/` 의 그 실행 로그와 `status` 를 본다 |
| `VM 직전 배포가 <상태> 로 끝남` (Plan 단계) | 직전 실행이 `switching`·`migrating`·`restore_failed`·`failed_after_migration` 으로 끝나 운영이 `.env` 와 다른 이미지로 돌 수 있다. 같은 sha 를 다시 돌려 "바꿀 것 없음" 으로 통과시키지 않는다 | `switching`·`restore_failed` 는 `make rollback-last`. `migrating`(upgrade 실패·중단)과 `failed_after_migration` 은 DB 를 확인한 뒤 비상 경로로 마무리한다(성공하면 `deployed` 로 돌아온다) |

### 롤백

| 상황 | 방법 |
|---|---|
| 방금 배포를 되돌린다 | `make rollback-last` — `deploy-state/last-deploy.env` 의 직전 태그로 되돌린다. 교체 도중 끊긴 배포(`LAST_STATUS=switching`, VM 재부팅·프로세스 강제 종료)와 복구가 실패한 배포(`restore_failed`)도 같은 명령으로 돌린다. migration 이 포함된 배포는 거부한다 |
| 특정 태그로 | `make rollback-backend TAG=<태그>` (`admin`·`web` 동일). 태그는 7~12자 sha. VM 에 없으면 GHCR 에서 받는다. VM compose 가 아직 옛 이미지 이름이면(Release 배포·sync 를 한 번도 안 했으면) 아무것도 하지 않고 멈춘다 |
| 특정 커밋으로(Actions) | Release 를 그 `sha` + `deploy=true` + `rollback=true` 로 실행한다 |
| migration 이 돈 backend | 자동화하지 않는다. 이전 backend 이미지는 새 revision 을 몰라 기동하지 못한다(deploy.sh 도 "DB 가 이미지보다 앞섰다" 로 거부한다). [§실제 복구](#실제-복구)로 DB 를 배포 직전 백업(`--migrate` 가 만든 것)으로 되돌린 뒤 `rollback-backend TAG=<이전>`. 같은 배포에서 실패한 admin·web 은 deploy.sh 가 이미 이전 태그로 되돌렸다 |

롤백도 `deploy.log` 에 `rollback … manual|auto|auto-restore` 로 남는다. `prune-images.sh` 는 `.env` 의 현재 태그와 직전 태그(`PREV_*`)를 지우지 않지만, 그보다 오래된 태그는 GHCR 에서 다시 받는다고 생각한다. 단일 Compose 교체는 무중단을 보장하지 않는다.

### 비상 경로 — `make deploy-*`

```bash
make deploy-backend                    # 빌드 → probe → 전송 → VM deploy.sh
MIGRATE=1 make deploy-backend          # migration 을 승인할 때 (종료 3 안내를 본 뒤)
make deploy-admin DEMO_ADMIN_EMAIL=…   # 저장소 Variable·VM .env 와 같은 값
make deploy-web
make oracle-logs                       # compose 로그 follow (최근 100줄)
```

세 `deploy-*` 는 먼저 **`deploy-guard`** 를 통과해야 한다 — HEAD 가 `origin/main` 에 포함돼 있고, 작업 트리가 깨끗하고, **현재 운영 태그가 배포할 HEAD 의 조상**이어야 빌드로 넘어간다. 이미지 태그가 커밋 sha 라서, 브랜치 HEAD 나 더러운 트리로 빌드하면 태그와 내용이 어긋나 "운영에 무엇이 올라가 있나" 를 되짚을 수 없다(2026-08-06 실제 사고). 빌드 인자는 `build-args.env` 와 같아야 하고(같은 태그의 GHCR 이미지와 내용이 갈라지지 않게), `TAG` 는 지정할 수 없다. 예외가 필요하면 `FORCE_DEPLOY=1` 로 명시하고 `deploy.log` 에 `forced` 로 남는다. `deploy.log` 형식은 `UTC시각 deploy|rollback 서비스 태그 auto|guarded|forced|manual|auto-restore` 다.

세 번째 조건(운영 태그 ∈ HEAD 조상)은 2026-09-20 후퇴 배포 미수 뒤에 들어왔다 — 그때 `4e15f8c` 로 backend 를 배포했다면 운영(`c066b02`)에만 있던 `API-HD-012` 가 사라졌을 텐데, `4e15f8c` 도 `origin/main` 의 조상이라 옛 가드를 통과했다. 가드는 호출부가 넘긴 `DEPLOY_SERVICE`(`BACKEND`·`ADMIN`·`WEB`)로 VM `~/truewords/.env` 의 `<SVC>_TAG` 를 읽어 판정하고, 후퇴면 **사라지는 커밋 목록을 출력하고 중단**한다.

| 증상 | 뜻 | 대처 |
|---|---|---|
| `ssh … 연결 실패(255)` | VM 에 닿지 못했다 | 터널·키를 확인한다. 확인하지 못한 채 배포하지 않는다 |
| `~/truewords/.env 를 읽을 수 없습니다` | 파일이 없거나 권한이 없다 | VM 에서 파일을 확인한다. **"첫 배포" 로 보고 통과하지 않는다** |
| `운영 태그 <sha> 를 로컬 git 에서 찾을 수 없습니다` | 운영 태그가 로컬에 없다 | `git fetch --all` 후 재시도 |
| `후퇴 배포입니다` + 커밋 목록 | 배포하면 그 커밋들이 운영에서 사라진다 | 의도한 되돌리기면 `rollback-*` 를 쓰고, 그래도 강행하려면 `FORCE_DEPLOY=1` 로 명시한다 |

비상 경로는 사람의 ssh 세션에서 **포그라운드로** 돈다. 교체 도중 연결이 끊기면 그 자리에서 멈출 수 있으니 안정된 연결에서 실행하고, 끊겼다면 `LAST_STATUS` 를 보고 `make rollback-last` 로 정리한다.

`deploy-backend` 는 이미지에 `alembic`·`uvicorn` 바이너리와 `/app/ALEMBIC_EXPECTED_HEAD` 가 있는지 확인한 뒤에야 전송한다(runtime stage 에 바이너리가 빠져 기동에 실패했던 dev-log 41~42 의 재발 방지). 전송은 로컬 tgz → `rsync --partial` → VM `docker load` 라 끊기면 그 단계만 다시 돈다.

### VM 파일 동기화

`deploy`·`sync` 는 `docker-compose.yml` 과 cron 스크립트(`deploy.sh` 의 `SYNC_FILES`)를 `~/truewords` 로 복사한다. 원본은 **배포 대상 sha 가 아니라 최신 main** 이다 — VM 진입점은 늘 최신 origin/main 으로 체크아웃해 그 `deploy.sh` 를 실행하고, 대상 sha 는 이미지 태그를 고르는 데이터로만 넘긴다. 그래서 옛 커밋으로 되돌려도 옛 배포 코드·cron 스크립트가 되살아나지 않는다. compose 를 되돌려야 하면 main 에 되돌림 커밋을 넣는다. 비상 경로는 가드를 통과한 로컬 HEAD 가 원본이다. 이전 사본은 `deploy-state/prev-files/` 에, 원본 커밋은 `deploy-state/synced-sha` 에 남는다. **`.env`·`preserve-images.txt`·백업은 건드리지 않는다.** 이미지가 바뀌지 않고 `infra/oracle-vm/` 만 바뀐 커밋은 컨테이너를 재시작하지 않고 `sync` 만 한다. 손으로 `scp` 하지 않는다.

배포가 교체하는 것은 backend·admin·web 뿐이다. compose 의 `postgres`·`qdrant`·`cloudflared` 정의가 바뀌면 파일은 동기화되지만 컨테이너는 그대로다 — Plan 단계가 `::notice::` 로 알려 준다. 적용은 사람이 한다: 백업 확인 → `ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env up -d --no-deps <서비스>'`. postgres·qdrant 재생성은 데이터 볼륨을 그대로 쓰지만 짧은 중단이 있다.

이미지 GC(`prune-images.sh`)는 배포 잠금을 존중한다. 주간 cron 이 배포와 겹치면 그 회차는 건너뛴다.

예외는 강제 명령 진입점 `~/truewords/bin/deploy-entry` 다. 배포로 갱신되지 않으므로(키가 스스로 권한을 넓히지 못하게) `deploy-entry.sh` 를 바꾼 PR 이 머지되면 아래 설치 스크립트를 다시 실행한다.

### 최초 설정 (1회)

순서대로 한다. 2·3 은 VM, 4 이후는 GitHub 이다.

1. 로컬에서 키 두 개를 만든다 — 배포 키, migration 키. 다른 용도로 쓰지 않는다.
   ```bash
   ssh-keygen -t ed25519 -N '' -C truewords-deploy@github-actions -f ~/.ssh/truewords_deploy
   ssh-keygen -t ed25519 -N '' -C truewords-deploy-migrate@github-actions -f ~/.ssh/truewords_deploy_migrate
   ```
2. VM 에 체크아웃과 진입점을 설치한다(다시 실행해도 같은 결과). 마지막에 `authorized_keys` 에 넣을 줄을 **출력만** 한다.
   ```bash
   ssh truewords-oracle "DEPLOY_PUBKEY='$(cat ~/.ssh/truewords_deploy.pub)' MIGRATE_PUBKEY='$(cat ~/.ssh/truewords_deploy_migrate.pub)' bash -s" < infra/oracle-vm/install-deploy-access.sh
   ```
3. 출력된 줄 중 `truewords-deploy@github-actions`(강제 명령 `…/deploy-entry`)와 `truewords-deploy-migrate@github-actions`(`env TW_ALLOW_MIGRATE=1 …/deploy-entry`) 두 줄을 확인하고 VM `~/.ssh/authorized_keys` 에 추가한다. 확인: `ssh -i ~/.ssh/truewords_deploy -o IdentitiesOnly=yes <user>@<host> status` 가 태그를 출력하고, `… 'status; id'` 와 배포 키의 `… 'deploy <sha> backend --migrate'` 는 거부돼야 한다. VM sshd 의 `AcceptEnv` 가 `LANG LC_*` 뿐이고 `PermitUserEnvironment` 가 꺼져 있는지도 본다(`sudo sshd -T | grep -Ei 'acceptenv|permituserenvironment'`) — 클라이언트가 `TW_ALLOW_MIGRATE` 를 보낼 수 없어야 한다. 함께 출력되는 `truewords-ops-read@github-actions` 줄은 ops-check 결과(`/opt/ops-status.json`)만 읽는 `ops-alert.yml` 용 키다 — [§전달 — GitHub Issue](#전달--github-issue-ops-alertyml) 설정에서 넣는다.
4. GitHub 환경 두 개를 만든다 — `production`, `production-migrate`. 둘 다 Required reviewers = 저장소 소유자, Deployment branches = `main` 만. 키·VM 주소·호스트 키는 **환경 secret** 이다(공개 저장소의 Actions 로그에서 마스킹된다). 같은 secret 이름에 환경마다 다른 키를 넣는다. `DEPLOY_HOST` 는 DNS 이름이 아니라 **IP** 로 넣는다 — 이름이면 ssh 오류 메시지에 해석된 IP 가 찍혀 마스킹을 비켜 간다. 호스트 키는 `ssh-keyscan` 결과를 VM 안의 지문(`ssh truewords-oracle 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'`)과 대조한 뒤에만 넣는다.
   ```bash
   gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/truewords_deploy
   gh secret set DEPLOY_SSH_KEY --env production-migrate < ~/.ssh/truewords_deploy_migrate
   for env in production production-migrate; do
     gh secret set DEPLOY_HOST --env "$env" --body '<VM 공인 IP>'
     gh secret set DEPLOY_HOST_KEY --env "$env" --body "$(ssh-keyscan -t ed25519 <VM 공인 IP> 2>/dev/null)"
   done
   ```
5. 저장소 Variable 을 넣는다(공개돼도 되는 값만).
   ```bash
   gh variable set DEPLOY_USER --body ubuntu
   gh variable set DEPLOY_PORT --body 22          # 22 면 생략 가능
   gh variable set DEMO_ADMIN_EMAIL --body '<VM .env 의 DEMO_ADMIN_EMAIL 과 같은 값>'
   ```
6. Release 를 `deploy=false` 로 한 번 실행해 이미지 3개를 만든 뒤, GitHub → Packages 에서 `truewords-backend`·`truewords-admin`·`truewords-web` 의 visibility 가 **Public** 인지 확인한다(아니면 바꾼다). VM 은 로그인 없이 받는다 — secret 이 이미지에 들어가지 않는 것이 이 전제다.
7. 첫 배포(`deploy=true`)가 compose 의 이미지 이름을 GHCR 로 바꾸고, 지금 돌고 있는 옛 이름(`truewords-<svc>:<태그>`) 이미지는 같은 ID 로 새 이름 태그를 붙여 이어 쓴다.
8. GHCR 정리(`ghcr-cleanup.yml`)는 예약 실행이 dry-run 이다. 수동 실행(dry_run=true) 로그에서 지울 버전이 맞는지 본 뒤 `gh variable set GHCR_CLEANUP_ENABLED --body true`.

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
*/15 * * * *  /home/ubuntu/truewords/send-hoondok-push.sh >> /home/ubuntu/truewords-cron.log   2>&1
```

| 작업 | 주기 | 왜 VM 이어야 하는가 |
|---|---|---|
| `backup-db.sh` | **6시간마다** (KST 09/15/21/03시) | Postgres 가 `127.0.0.1` 바인딩이라 외부에서 닿을 수 없다 |
| `refresh-questions.sh` | 매주 월 03:30 KST | 같은 이유 (Postgres 필요) |
| `ops-check.sh` | 매일 03:45 KST | **감시자는 감시 대상과 다른 실패 도메인에 있어야 한다.** GHA 가 멈춘 사고에서 유일하게 정상 작동한 게 VM cron 이었다 |
| `prune-images.sh` | 매주 월 04:15 KST | 이미지는 VM 로컬 자원이다. 배포 때마다도 돌지만, 배포가 없는 주에도 빌드 캐시가 쌓이므로 주간 보루를 둔다 |
| `send-hoondok-push.sh` | **15분마다** | Postgres 가 필요하고, GHA 청구 차단으로 예약 작업이 25일간 조용히 멈춘 이력이 있다(PLAN-HD-006 §2-6). 사용자마다 발송 시각이 달라 창에 든 사람을 15분 간격으로 찾는다 — 하루 1회 보장은 `push_subscriptions.last_sent_on` 이 갖는다 |

`cache-cleanup.sh` 는 **cron 에 등록하지 않는다.** 스케줄 주인은 `.github/workflows/cache-cleanup.yml` 이고 (Qdrant 는 HTTPS 라 어디서든 닿는다), VM 쪽 스크립트는 수동 실행 진입점으로만 남긴다. 스케줄러가 둘이면 같은 작업이 두 번 돈다.

> 추천 질문 갱신은 원래 GitHub Actions 에서 돌았다. Postgres 가 VM 로컬로 옮겨오면서 runner 가 DB 에 닿을 수 없게 됐는데 `DATABASE_URL` secret 은 낡은 Neon 값이었다. 워크플로를 그대로 뒀다면 **죽은 DB 에 붙어 "성공"을 기록**했을 것이다. 옮긴 게 아니라 옮길 수밖에 없었다.

수동 실행은 로컬 Mac 의 make target 을 쓴다.

```bash
make ops-check                             # 운영 불변식 점검 (9건)
make gemini-check                          # Gemini 키 생존만 단독 확인
make cron-cache-cleanup ARGS=--dry-run     # 삭제 대상만 확인
make cron-cache-cleanup                    # GHA 가 멈춘 동안 대신 실행
make cron-refresh-questions ARGS=--dry-run # 대상 봇만 확인 (Gemini 호출 0)
make cron-refresh-questions                # 실제 갱신
make restore-drill                         # 백업 복구 리허설
```

로그: `tail ~/truewords-cron.log`, `tail ~/truewords-backup.log`. GHA 쪽 실행 이력은 Actions 탭.

### 1회 실행 스크립트 (말씀 서고 개통)

말씀 서고(PLAN-HD-007)의 권리 원장 시드와 장 목차 추출은 **cron 이 아니다.** 데이터가 바뀌지 않는 한 개통 때 한 번, Qdrant 에 권이 추가되면 그때 다시 돌린다. cron 표에 넣지 않는다.

```bash
ssh truewords-oracle
cd /home/ubuntu/truewords

# 1) 권리 원장 시드 — Qdrant volume 664 → 6시리즈 분류 → content_rights upsert
docker compose --env-file .env exec -T backend \
  python scripts/seed_content_rights_from_qdrant.py --execute \
  --allow "천성경,평화경,원리강론" --grade O1

# 2) 장 목차 추출 — 본문 규칙으로 volume_sections 를 채운다 (origin='auto' 만 교체)
docker compose --env-file .env exec -T backend \
  python scripts/extract_volume_sections.py --execute
```

- 두 스크립트 모두 `--execute` 없이 `--dry-run` 이 기본이고, **운영(`ENVIRONMENT=production`)에서는 `--execute` 로만 돈다.** 대신 `--execute` 가 쓰기 전에 같은 계획·커버리지 표를 stdout 에 내므로, 그 출력을 그대로 rollout runbook 에 기록한다. 계획만 미리 보려면 로컬(운영 사본 Qdrant)에서 `--dry-run` 을 먼저 돌린다.
- 시드는 **이미 있는 행의 `status`·`scope_*`·`authority_grade`·`note` 를 건드리지 않는다.** 재실행해도 운영자가 admin 에서 정한 값이 되돌아가지 않는다. 예외는 `--allow` 로 명시한 시리즈 — 운영자 의도로 보고 기존 행도 연다. 단 `status=withdrawn` 행은 이 예외에서도 제외되어 그대로 닫혀 있고, 건너뛴 권 목록만 stdout 에 나온다.
- 추출은 `volume_sections` 의 `origin='auto'` 행만 교체하고 수기(`manual`) 행은 남긴다. 장이 0건인 권은 비워 두고 화면이 "구간 N" 으로 폴백한다.
- 2 번은 615 권을 순서대로 훑어 **수십 분** 걸린다. `--series father_anthology` · `--volume "천성경.pdf"` 로 나눠 돌릴 수 있다.
- 순서는 반드시 1 → 2 다. 2 의 기본 대상은 1 이 만든 `content_rights` 행이다.

## 운영 불변식 점검 (`ops-check.sh`)

2026-07-24~29 에 `cache-cleanup.yml` 이 5일간 매일 실패했는데 아무도 몰랐다. 조사에서 두 가지가 확인됐다 — GitHub 은 알림을 **만들지 않았고**(`gh api notifications?all=true` 빈 목록), 실패한 run 의 job 은 `steps_count: 0` 이었다. **청구 차단은 job 을 아예 시작하지 않으므로 워크플로 안의 `if: failure()` 알림 스텝으로는 이 사고를 잡을 수 없다.**

그래서 감시를 **다른 실패 도메인**(VM cron)에 두고, "job 이 돌았는가" 대신 **"결과가 기대대로인가"** 를 본다.

| 검사 | 임계 | 잡는 것 |
|---|---|---|
| `backup` | 로컬 최신 덤프 < 8h | `backup-db.sh` 미실행·실패 |
| `backup-remote` | Object Storage 사본 < 8h (`truewords-` prefix 전체 조회) | 업로드가 조용히 실패 (스크립트가 의도적으로 무시하는 경로). 버킷은 다른 프로젝트와 공유하고 `object list` 는 이름순 100개만 돌려주므로 prefix 없이 보면 오탐(2026-08-27~09-05 "209h 전" 사례) |
| `cache-ttl` | 만료 ≤ 50건 | `cache-cleanup.yml` 미실행 (스케줄러 위치 무관) |
| `suggested-q` | `max(suggested_at)` < 10일 | `refresh-questions.sh` 미실행 |
| `containers` | 이 VM 의 compose 에 정의된 서비스 전부 — cloudflared 는 up, 나머지 healthy | 분리 전(5개)·분리 후(web 포함 6개) 구성을 같은 스크립트로. compose 에 없는 web 은 오탐이 아니고, 정의됐는데 죽으면 FAIL |
| `disk` | < 70% 주의 / < 80% 임계 | 디스크 포화. 한 달에 25GB 늘던 실측(2026-08-30)에서 80% 는 남은 시간이 3주도 안 됐다. WARN 은 종료코드를 바꾸지 않는다 |
| `gemini-key` | embed + generate 둘 다 HTTP 성공, embed 차원 = 1536 | **유일한 외부 의존 사망** — 키 회수·청구 중단·quota 소진·모델 폐기·차원 변경 |
| `hoondok-today` | 오늘·내일 편성 존재 | 운영자 수기 편성이 끊겨 홈이 "오늘 말씀 없음" 이 되는 것. WARN 이라 종료코드를 바꾸지 않는다 |
| `hoondok-push` | 구독이 있는데 `max(last_sent_on)` 이 어제보다 이전 · 또는 알림 켠 사용자 ≥1 인데 구독 0 | 발송 cron 중단·VAPID 누락 · 구독이 삭제됨(발송기 prune·브라우저 데이터 삭제). 켠 사용자도 0이면 아직 아무도 켜지 않은 정상 상태라 OK. WARN |

```bash
make ops-check
# CHECK      VERDICT DETAIL
# backup     OK     8h 전 · truewords-2026-07-29-1800.dump · 11M
# cache-ttl  OK     만료 0건
# gemini-key OK     embed 0.50s·1536d · generate 0.90s·tok in=2/out=9/think=0 · key sha8=… · tier=paid
# ...
# RESULT: OK — 불변식 9건 전부 통과
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
make ops-check                                          # 정상 — 9건 통과
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

탐지(위 9건)와 별개로 **전달**이 없어 2026-08-07~31 에 `cache-cleanup.yml` 이 25일간 안 돌았는데도(GHA 청구 차단 재발) 아무도 몰랐다. `ops-check.sh` 는 매일 `cache-ttl FAIL` 을 `/opt/ops-status.json` 에 적고 있었다. 그래서 스크립트 마지막에 [ntfy.sh](https://ntfy.sh) 푸시 한 줄을 붙였다.

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

> 한계: **cron 자체가 안 돌면 이 방식으로는 모른다.** 스크립트가 실행돼야 푸시가 나간다. 그 공백은 아래 `ops-alert.yml` 이 "결과가 낡음" 으로 잡는다(`backup-db.sh` 의 미실행은 다음 ops-check 의 `backup` 항목이 잡는다). 배경: [ADR](../../docs/adr/2026-07-30-silent-scheduled-job-failure.md)

### 전달 — GitHub Issue (`ops-alert.yml`)

앱 없이 받는 1차 채널이다. Actions 가 매일 19:20 UTC(ops-check 35분 뒤)에 VM 의 `/opt/ops-status.json` 을 **당겨 와** 판정하고, 문제가 있으면 `[ops-alert] VM 점검 — …` 이슈를 연다(새 이슈는 저장소 소유자에게 메일). VM 에는 GitHub 토큰을 두지 않는다. 판정 규칙의 원본은 `tooling/checks/ops-alert-report.mjs` 다.

| 결과 | 이슈 |
|---|---|
| FAIL·WARN 항목 | 항목별 이름·판정·DETAIL. 버킷 이름·키 지문(`sha8=`)·OCID·IP 는 가린다(공개 저장소) |
| VM 에 닿지 못함 · ops-status 를 읽지 못함 · ssh 설정 실패 | ssh 오류 원문은 싣지 않는다(주소가 섞인다). 종료 코드로만 구분한다 |
| 결과가 낡음(`checked_at` 이 26시간 넘게 지남) | VM cron 이 멈췄다 — `crontab -l`·`~/truewords-cron.log` |
| 결과 JSON 형식 오류 | 원문 대신 크기만 적는다 |
| 전부 OK(SKIP 포함) | 이 워크플로가 연 `[ops-alert] VM 점검` 이슈만 닫는다. `cache-cleanup.yml` 의 이슈는 건드리지 않는다 |

열린 이슈가 있으면 새로 열지 않고 댓글을 단다. 수동 실행: Actions → **Ops alert** → Run workflow(main).

설정(1회, 배포 설정의 1~3과 같은 설치 스크립트를 쓴다):

1. 키를 만든다: `ssh-keygen -t ed25519 -N '' -C truewords-ops-read@github-actions -f ~/.ssh/truewords_ops_read`
2. 설치 스크립트를 `OPS_PUBKEY="$(cat ~/.ssh/truewords_ops_read.pub)"` 와 함께 실행하고, 출력된 `truewords-ops-read@github-actions` 줄(`env SSH_ORIGINAL_COMMAND=ops-status …/deploy-entry`)을 `authorized_keys` 에 넣는다. 확인: `ssh -i ~/.ssh/truewords_ops_read -o IdentitiesOnly=yes <user>@<IP> 'deploy x'` 도 JSON 만 출력해야 한다.
3. GitHub 환경 `ops-read` — Required reviewers **없음**(예약 실행이 승인을 기다리지 않게), Deployment branches = `main` 만. 환경 secret:
   ```bash
   gh secret set OPS_READ_SSH_KEY --env ops-read < ~/.ssh/truewords_ops_read
   gh secret set DEPLOY_HOST --env ops-read --body '<VM 공인 IP>'
   gh secret set DEPLOY_HOST_KEY --env ops-read --body "$(ssh-keyscan -t ed25519 <VM 공인 IP> 2>/dev/null)"
   ```
   `DEPLOY_USER`·`DEPLOY_PORT` 는 배포와 같은 저장소 Variable 을 쓴다.
4. Run workflow 로 한 번 돌려 정상이면 이슈가 생기지 않는 것, `ops-read` secret 하나를 일부러 비우면 "ssh 설정 실패" 이슈가 생기는 것을 본다(반증 가능한 리허설). 확인 뒤 되돌리고 이슈를 닫는다.

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
| 관리자 화면 전체가 403 / access-denied | `.env` 의 `DEMO_ADMIN_EMAIL` 이 비어 있거나 로그인 계정과 다릅니다. 값을 채우고 `sudo docker compose up -d --wait backend`. admin 이미지도 같은 값으로 빌드돼야 합니다(`make deploy-admin DEMO_ADMIN_EMAIL=…`). |
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
| 계정 | 운영자 개인 Google 계정 — `jetaime-dev` 소유 계정과 **다름**. 주소는 public 문서에 두지 않는다(VM `.env` 관리자가 안다) |
| 키 이름 | Gemini API Key |

인프라 작업에 쓰던 `jetaime-dev` 프로젝트(별도 계정)가 **아니다.** `jetaime-dev` 에도 "DEV Gemini API Key" 가 있지만 그건 운영 키가 아니다(해시 대조로 확인).

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
