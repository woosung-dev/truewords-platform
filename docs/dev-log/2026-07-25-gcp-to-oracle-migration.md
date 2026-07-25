# GCP에서 Oracle Cloud ARM VM으로 이전 ADR

GCP 운영 비용을 없애면서 검증된 단일 노드 구성을 채택한 이유와 의도적으로 하지 않은 변경을 기록한다.

> 결정일: 2026-07-25.
>
> 운영 절차는 [`docs/07_infra/oracle-vm-migration.md`](../07_infra/oracle-vm-migration.md)에 분리한다.

## Context

기존 운영은 asia-northeast3의 GCP Cloud Run FastAPI backend 1Gi / 1CPU / min-instances 1대와 GCP VM Qdrant e2-medium 2 vCPU / 4GB로 월 `$50~70`을 사용했다.

Oracle Cloud Always Free ARM의 `VM.Standard.A1.Flex` 한 대는 2 OCPU / 12GB / 200GB를 제공한다. backend와 Qdrant를 함께 실행해도 기존 Qdrant VM보다 메모리가 3배이고 Always Free 한도 안의 청구액은 `$0`이다.

Always Free ARM 한도는 2026-06-15에 4 OCPU / 24GB에서 2 OCPU / 12GB로 축소됐다. Oracle은 별도 공지 없이 문서 값만 갱신했으므로, 설계와 운영 여유는 축소된 한도를 기준으로 잡는다.

## 결정

| 결정 | 채택 | 이유 |
|---|---|---|
| 이전 범위 | Qdrant와 backend만 Oracle VM으로 이전 | Neon과 Vercel은 이미 무료이며 백업과 무중단 이점이 있다. |
| 외부 노출 | Cloudflare Tunnel | 공인 앱 endpoint, 인바운드 방화벽, 인증서 운영을 없앤다. |
| 이미지 빌드 | Apple Silicon 로컬 Mac native arm64 | `docker buildx --platform linux/arm64`가 실제 arm64 환경을 빠르게 만든다. QEMU를 쓰지 않는다. |
| 계정 | Oracle PAYG 업그레이드 | Always Free 사용량 안에서는 `$0`이고, 7일간 CPU 95th percentile이 20% 미만이면 인스턴스를 정지하는 idle reclaim 대상에서 제외된다. 시범 운영 트래픽에서는 reclaim 가능성이 높다. |

### 범위에서 Neon과 Vercel을 제외한 이유

PostgreSQL을 VM에 넣으면 DB 백업, 복구, 업데이트, 단일 노드 장애를 새로 운영해야 한다. Neon은 이미 무료이면서 이 책임을 분리한다. Admin을 Vercel에서 내리면 build와 edge delivery, Vercel rollback 이점을 잃지만 비용 이득은 없다. 따라서 두 서비스는 이전의 변경 표면만 늘리므로 유지한다.

### Cloudflare Tunnel과 Caddy 공인 IP 비교

| 선택지 | 결과 |
|---|---|
| Cloudflare Tunnel | VM에서 outbound 연결만 열고 `api.<zone>`과 `vdb.<zone>`을 Cloudflare가 TLS 종료한다. |
| Caddy와 공인 IP | 80/443 인바운드, 인증서 갱신, IP 스캔과 방화벽 관리가 필요하다. |

Cloudflare Tunnel을 택한다. 기존 GCP tunnel token을 재사용하지 않고 신규 `truewords-oracle` tunnel을 만든다. 동일 tunnel에 GCP와 Oracle connector가 동시에 붙으면 Cloudflare가 요청을 임의 분산해 split-brain이 된다.

### 빌드 위치 비교

| 선택지 | 결과 |
|---|---|
| 로컬 Apple Silicon Mac | native arm64 빌드다. 실측 이미지 1.02GB와 `machine: aarch64`를 확인했다. |
| Oracle VM 내부 | VM 용량과 운영 자원을 build에 사용하고 배포 시간이 길어진다. |
| GitHub Actions QEMU | 에뮬레이션 build가 느리고 이 작은 운영 구성에 CI 배포 경로를 추가한다. |

로컬 Mac native arm64 빌드를 채택한다.

### 이미지 전달과 자동 배포

이미지는 `docker save | gzip -1 | ssh ... sudo docker load`로 전달한다.

| 대안 | 제외 근거 |
|---|---|
| GHCR | private repository Free 플랜은 월 transfer 1GB이고 이미지 하나가 1.02GB라 사용할 수 없다. |
| OCIR | 별도 registry와 신규 Oracle credential을 관리해야 한다. |
| main push 자동 배포 | GitHub Actions에서 VM으로 배포하려면 SSH key secret과 VM 인바운드 SSH 노출이 필요해 tunnel 채택 취지와 맞지 않는다. |

따라서 배포는 main push 자동화 대신 `make deploy-backend` 수동 실행으로 둔다. 로컬 업로드가 100Mbps 미만이거나 주당 배포가 3회를 초과하면 OCIR을 재검토한다.

## 데이터 이전 결정

| 방식 | 결과 | 결정 |
|---|---|---|
| Qdrant Snapshot API | HNSW 인덱스와 컬렉션 config를 포함하며 소스를 변경하지 않는다. 30~60분 예상이다. | 채택. |
| re-upsert | 417,579 points를 다시 쓰고 2 OCPU에서 HNSW 재구축 2~4시간과 후속 인덱싱이 든다. | 제외. |
| Qdrant data directory tar | 파일 일관성을 위해 Qdrant 중지와 스토리지 파일 호환성을 관리해야 한다. | 제외. |

검증은 기존 `backend/scripts/verify_migration.py`를 그대로 사용한다. 변수 이름은 `QDRANT_CLOUD_*`와 `QDRANT_VM_*`로 고정돼 있지만, 이번에는 각각 GCP 소스와 Oracle 타깃을 의미한다. `points_count`가 아니라 `POST /collections/<c>/points/count`의 `{"exact":true}`로 검증한다.

`semantic_cache`는 snapshot 시점 이후 구 스택에 쌓인 엔트리를 버린다. TTL 7일 캐시이고 miss가 정상 RAG 경로이므로 기능 손실은 없다.

## 코드 수정의 범위

이번 이전에서 수정한 코드는 `backend/src/chat/dependencies.py`의 cache cooldown 한 건뿐이다. 기준은 이전 때문에 새로 생기는 실패만 고친다는 것이다.

| 제외 항목 | 제외 근거 |
|---|---|
| XFF 무조건 신뢰 `backend/src/safety/middleware.py` | 이전으로 인한 변화가 없다. Cloud Run LB 뒤에서도 같은 우회가 성립하므로 TODO로 이월한다. |
| `ensure_main_collection()` 호출처 0건 | snapshot 복구가 컬렉션을 config째 생성한다. lifespan에 넣으면 과거 cold-start `ConnectTimeout` 문제를 재도입할 수 있다. |
| `/readyz` 신설 | Compose healthcheck의 기존 `/health`와 Python stdlib만으로 충분하다. `alembic upgrade head`가 실패하면 uvicorn이 exec되지 않아 `--wait`가 컨테이너 실패를 잡는다. |
| 임시파일 누적 | 이전이 새로 만드는 실패가 아니다. 별도 운영 정리 대상이다. |
| alembic 매 기동 | 기존 동작이며 이전 자체의 실패 원인이 아니다. 소킹 중 두 backend의 동시 실행만 main merge 동결로 통제한다. |
| 과대한 timeout | 이전으로 발생한 오류가 아니라 기존 운영 튜닝 문제다. |
| BM25 CPU 경합 | 2 OCPU에서 관찰할 성능 위험이지만 이전 전 코드 수정으로 확정할 문제가 아니다. |
| fastembed `/tmp` 재다운로드 | 로컬 Docker Desktop에서는 디스크 포화 실측이 있었지만 Oracle 부트 볼륨 100GB에서는 현재 차단 조건이 아니다. 디스크 사용량을 관찰한다. |

소킹 48시간 동안 `backend/**`의 main 머지를 금지한다. Oracle과 Cloud Run backend가 같은 Neon DB에서 `alembic upgrade head`를 동시에 실행할 수 있기 때문이다.

## Generator-Evaluator 크로스체크 결함

### PR 1. backend 이미지 부재 시 최초 부팅 실패

`cloudflared`의 `depends_on`에 backend가 있으면 `docker compose up -d qdrant cloudflared`가 backend까지 생성하려 한다. backend 이미지가 아직 없는 새 VM은 이 시점에 전체 부트스트랩이 실패한다.

dry-run으로 재현한 뒤 `cloudflared`가 `qdrant`에만 의존하도록 수정했다. cloudflared는 origin 연결을 요청 시점에 재시도하므로 backend 기동 순서 보장이 필요 없다.

### PR 2. lifespan 미실행 앱의 cache cooldown 회귀

쿨다운 guard가 `state.cache_available`을 직접 참조하면 lifespan을 실행하지 않은 앱에서 `AttributeError`가 난다. 기존 코드가 같은 위치에서 `getattr`을 쓴 것은 이 경우를 막기 위한 의도적 방어였는데 이를 놓쳤다.

기존 테스트 2건은 400을 기대하는 자리에서 500을 반환했다. guard를 `getattr` 방어와 호환되게 고쳐 회귀를 제거했다.

### PR 3. backend 롤백 태그 기본값으로 인한 no-op

`make rollback-backend`를 `TAG` 없이 호출하면 `TAG ?= $(shell git rev-parse --short HEAD)` 기본값이 발동해 현재 HEAD로 "롤백"한다. 배포 직후 장애 상황에서 반사적으로 호출하는 경로인데, 방금 배포한 태그를 그대로 재기록하므로 compose가 컨테이너를 재생성하지 않는다. 롤백했다고 믿는 사이 깨진 빌드가 계속 서비스된다. HEAD가 전진한 뒤라면 VM에 없는 태그가 `.env`에 기록되어 이후 `docker compose up` 자체가 깨진다.

`$(origin TAG)` 가드로 명시 전달을 강제해 해결했다. `Makefile:134-138`이 `TAG=<직전 배포 sha>` 없이 실행되는 롤백을 막는다.

## 검증 결과

- arm64 native build 성공. 이미지 1.02GB, `machine: aarch64`를 확인했다.
- aarch64 실호출 성공. `pymupdf 1.27.2.2`, `onnxruntime 1.24.4`, `kss`의 pecab backend, fastembed BM25 `nnz=4`, `bcrypt`, `asyncpg 0.31.0`을 확인했다.
- backend pytest는 `917 passed / 4 skipped / 1 xfailed`다.

## 남은 리스크

- Oracle A1 host capacity가 없어 VM 생성이 지연될 수 있다.
- 단일 VM은 Cloud Run의 자동 재시작과 revision rollback을 잃는 SPOF다.
- Oracle이 공지 없이 Always Free 한도를 변경한 전례가 있으므로 계정과 한도를 정기적으로 확인해야 한다.
