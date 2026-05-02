# Semantic Cache Cleanup 운영 가이드

> Qdrant 기반 `semantic_cache` 컬렉션의 만료 point 를 주기적으로 삭제하는 운영
> 절차. 인프라 무관 — 어떤 환경(EC2/Docker/k8s/Cloud Run/온프레미스)에서도 동일
> 스크립트 + trigger 만 환경별로 선택.

## 왜 필요한가

Qdrant 는 native point TTL 을 지원하지 않는다. `SemanticCacheService.check_cache`
의 `created_at >= now - CACHE_TTL_DAYS*86400` 필터는 **읽기 시 무시**하는 필터일
뿐, 디스크의 만료 point 는 그대로 남아 누적된다.

운영 부담:
- 디스크 비대화 (수개월 운영 시 수백 MB ~ GB)
- HNSW 인덱스 latency 증가 (segment 비대화 → search 시간 ↑)
- semantic_cache 의 false hit 위험 ↑ (오래된 답이 invalidate 되지 않은 채 캐시
  히트의 base 가 됨)

## 스크립트

`backend/scripts/cleanup_semantic_cache.py` — standalone Python (raw httpx,
HTTP/1.1). 환경변수만 의존. 다음 정책:

- `payload.created_at < now - CACHE_TTL_DAYS*86400` 인 point 일괄 삭제
- Qdrant filter 기반 batch delete (scroll 불필요, 단일 REST 호출)
- `--dry-run` / `--execute` 모드 분리
- Idempotent — 여러 번 실행해도 안전

### 사용

```bash
cd backend

# 미리보기 (삭제하지 않음)
uv run python scripts/cleanup_semantic_cache.py --dry-run

# 실제 삭제
uv run python scripts/cleanup_semantic_cache.py --execute

# TTL override (기본 7일 → 14일로 보존하여 더 적게 삭제)
uv run python scripts/cleanup_semantic_cache.py --execute --ttl-days 14
```

### 환경변수 (모두 옵션)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST URL |
| `QDRANT_API_KEY` | (빈) | API key (local 은 빈 문자열 허용) |
| `CACHE_COLLECTION_NAME` | `semantic_cache` | 컬렉션 이름 |
| `CACHE_TTL_DAYS` | `7` | TTL 일수 (스크립트 `--ttl-days` 가 우선) |

`backend/.env` 가 자동 로드되므로 별도 export 불필요.

### 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 성공 (삭제 0건 포함) |
| 1 | Qdrant API 오류 또는 호출 실패 |

## 환경별 Trigger 셋업

스크립트는 어디서든 똑같이 동작한다. 차이는 **언제 실행할지** 하나뿐.

### 1. EC2 / 일반 Linux 서버 (system cron)

```bash
crontab -e
```

```cron
# 매일 새벽 3시 (KST) 실행, 로그는 /var/log/cache-cleanup.log
0 3 * * * cd /home/ubuntu/truewords/backend && /usr/local/bin/uv run python scripts/cleanup_semantic_cache.py --execute >> /var/log/cache-cleanup.log 2>&1
```

검증:
```bash
sudo cat /var/log/cache-cleanup.log | tail -20
sudo journalctl -u cron --since "today" | grep cleanup
```

### 2. Docker Compose (cron sidecar)

`docker-compose.yml`:
```yaml
services:
  cache-cleanup:
    image: <truewords-backend-image>
    working_dir: /app/backend
    environment:
      QDRANT_URL: http://qdrant:6333
      QDRANT_API_KEY: ""
    command: >
      sh -c "while true; do
        uv run python scripts/cleanup_semantic_cache.py --execute;
        sleep 86400;
      done"
    depends_on: [qdrant]
    restart: unless-stopped
```

### 3. Kubernetes (CronJob)

`k8s/cleanup-cronjob.yaml`:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: semantic-cache-cleanup
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: cleanup
            image: <truewords-backend-image>
            workingDir: /app/backend
            command: ["uv", "run", "python", "scripts/cleanup_semantic_cache.py", "--execute"]
            env:
            - name: QDRANT_URL
              valueFrom: {secretKeyRef: {name: qdrant-secret, key: url}}
            - name: QDRANT_API_KEY
              valueFrom: {secretKeyRef: {name: qdrant-secret, key: api_key}}
```

### 4. GCP Cloud Run (Scheduler + 별도 endpoint)

Cloud Run 자체엔 cron 이 없으므로 별도 trigger 필요. 옵션:
- (간편) Cloud Scheduler 가 인증된 HTTP endpoint 호출 → 백엔드가 같은 cleanup
  로직 실행
- (대안) Cloud Run Jobs 로 주기 실행 (Cloud Run 의 제2 자원)

본 가이드에서는 인프라 무관성을 위해 EC2/k8s 기준으로 정렬했다.

## 첫 실행 시 권장 절차

1. **dry-run 으로 영향 확인** (절대 first-time --execute 금지):
   ```bash
   uv run python scripts/cleanup_semantic_cache.py --dry-run
   ```
   출력 예:
   ```
   [count] total=15234  expired=2188  alive=13046
   [dry-run] 2188 point 삭제 예정. 실행하려면 --execute
   ```
2. **expired 비율 검토** — 50% 이상이면 운영 hit rate 와 cache 로직 의도 일치
   여부 확인 (의도된 누적인지, leak 인지).
3. **--execute** 1회 수동 실행 후 디스크 사용량 변화 측정.
4. cron 등록.

## 모니터링

스크립트 stdout 의 핵심 라인:
```
[count] total=15234  expired=2188  alive=13046
[done] before=15234  after=13046  removed=2188
```

GCP Logging / CloudWatch 에서 다음 패턴으로 알림 설정 권장:
- `[error]` 포함 → 알림 발송
- `removed != expected` 경고 (동시 쓰기 충돌, 일반적으론 무시 가능)

## 관련 문서

- `docs/dev-log/55-semantic-cache-hardening.md` — 본 작업 ADR (SaaS 업계 비교 +
  결정 근거)
- `backend/src/cache/service.py` — semantic cache 본 로직 (invalidation 메타데이터
  포함)
- `backend/scripts/cleanup_semantic_cache.py` — 본 가이드의 스크립트 본체
