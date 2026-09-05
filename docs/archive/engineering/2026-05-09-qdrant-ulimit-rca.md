# 2026-05-09 — Qdrant 503 RCA: open file 한도

## TL;DR

운영 Qdrant 가 가동 시간이 누적되면 `503 Bad Gateway` 가 다발하며 컨테이너가 자가 abort → docker restart 정책으로 재기동되는 패턴이 5/8, 5/9 반복 발생. PR #141 의 "page cache 누적 + timeout 부족" 가설은 **부정확**했다. 실제 근본 원인은 컨테이너 default `ulimit -n = 1024` (open files soft limit) 도달 — RocksDB 가 segment SST 파일을 mmap 으로 열어두며 운영 시간/IO 함수로 fd 가 누적된다.

`ulimits.nofile = 65536` 적용으로 즉시 해결.

## 사고 타임라인

| 시점 (KST) | 이벤트 |
|------|------|
| 2026-05-08 ~02:00 | timeout 임박 (12-17s) 감지, `docker restart qdrant` 1차 — PR #139 (fallback 503 변환) + PR #141 (timeout 30s + retry backoff) 머지 |
| 2026-05-09 17:30 | 같은 패턴 503 재발 — 우리(에이전트) 가 27h 가동 unhealthy 컨테이너 감지 |
| 2026-05-09 18:08 | `docker restart qdrant` 2차. healthy 회복 |
| 2026-05-09 18:36 | PR #142 (chat-ui 8건 + persona 캐시) 머지 → Cloud Run 재배포 |
| 2026-05-09 18:55 | 재배포 직후 503. 1차로는 cold start 추정 |
| 2026-05-09 19:08 | `malssum_poc` (구버전) 컬렉션 삭제 — 메모리 -735MB 절감 (D 옵션). 24h 모니터링 가설 채택 |
| 2026-05-09 19:00~19:06 | PR #143 (display_name) 머지 → 또 503 |
| 2026-05-09 19:08 | docker logs 분석 — Qdrant 컨테이너 `Up About a minute` 발견. 자가 재기동 확인 |
| 2026-05-09 19:09 | logs 에서 `Too many open files` panic 메시지 발견 — **진짜 원인 확정** |
| 2026-05-09 19:10 | compose 에 `ulimits.nofile: 65536` 추가 + recreate. healthy + chat 정상 |

## 결정적 로그

```
ERROR qdrant::startup: Panic occurred in file
  lib/segment/src/index/query_optimization/payload_provider.rs at line 53:
  Payload storage is corrupted: Service runtime error:
  RocksDB get_pinned_cf error: IO error:
  While open a file for random read:
  ./storage/collections/semantic_cache/0/segments/.../000359.sst:
  Too many open files

panicked at reqwest-0.12.9/src/blocking/client.rs:1010:38:
thread panicked while processing panic. aborting.
./entrypoint.sh: line 25:     6 Aborted (core dumped) ./qdrant $@
```

`docker inspect qdrant /proc/<pid>/limits` 출력:
```
Max open files            1024                 524288               files
                          (soft)               (hard)
```

## 가설 vs 사실

| 가설 | 실제 | 비고 |
|------|------|------|
| 24h 가동 누적 → docker restart cron 도입 | **부정확** | 5/8 → 5/9 반복은 우연이 아니라 트래픽/IO 함수. 수동 restart 자체가 원인 가린 처방 |
| Page cache 누적 → mem_limit 상향 / VM 업그레이드 | **부분적** | 메모리도 빠듯하나 panic 직접 원인은 아님. 단 D (구버전 컬렉션 삭제) 가 메모리 -735MB / segment 수 감소로 fd 누적 속도도 약간 늦춤 (간접 효과) |
| **컨테이너 default ulimit 1024** | **정답** | RocksDB 가 모든 segment SST 를 mmap 유지. malssum_poc_v5 segments 단독 3.5GB → SST 수백 개. 운영 트래픽으로 추가 read fd 누적. 1024 도달 즉시 panic |

## 처방

### 즉시 (적용 완료)

운영 VM `/home/jangwooseng97_gmail_com/qdrant-vm/docker-compose.yml`:

```yaml
services:
  qdrant:
    ...
    mem_limit: 3g
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
    healthcheck:
      ...
```

`docker compose up -d qdrant` 으로 recreate. 새 ulimit 적용 확인:
```
Max open files  65536  65536  files
```

### 영구 반영

- `infra/qdrant-vm/docker-compose.yml` 에 동일 변경 반영 (본 PR)
- `setup-vm.sh` 첫 실행 또는 재프로비저닝 시 자동 적용

### 추가 follow-up (별도 트랙)

- [ ] **fd 사용량 모니터링** — `ls /proc/$(pidof qdrant-bin)/fd | wc -l` 주기 측정. 65536 의 50% 도달 시 알림
- [ ] Qdrant 1.12 의 `optimizer.max_segment_size` 튜닝 — segment 분화 줄이기 (작은 segment 가 많을수록 fd 부담)
- [ ] `mem_limit: 3g` 도 워킹셋에 빠듯 — 추후 데이터 증가 시 VM 업그레이드 또는 quantization 별도 검토

## 관련 PR

- PR #139: fallback 의 unhandled httpx 예외 → 503 변환 (사용자 메시지 친절화 — 이번 사고에서도 도움)
- PR #141: timeout 15s → 30s, retry backoff 0.3 → 0.5 (직접 원인은 아니었으나 누적 buffer 확대로 panic 임박을 늦췄을 가능성)
- PR #142: chat-ui 피드백 8건 + persona 캐시 격리 (사고와 무관, 시점 일치는 우연)
- PR #143: display_name 인라인 편집 (사고와 무관, 시점 일치는 우연)
- 본 PR (예정): `infra/qdrant-vm/docker-compose.yml` ulimits 동기화 + 본 ADR

## 교훈

1. **자동 restart cron 같은 증상 회피 처방을 도입하지 않은 결정이 옳았다.** cron 만 넣었으면 fd 누적은 그대로 유지되며 24h 마다 강제 cycle 만 돌았을 것. 사용자 결정으로 D 만 적용 후 재발 시점을 데이터로 받아 진짜 원인에 도달.
2. **"운영 시간 누적" 패턴을 보면 fd / 메모리 / 파일 핸들 / WAL / segment 분화 같은 "실 자원 누적"을 우선 의심**. timeout 같은 응답성 변수만 보면 표면 증상에 머무른다.
3. Qdrant 공식 운영 가이드의 ulimit 권장 (`nofile 65535`) 을 setup-vm 시점에 적용했으면 사고 자체가 없었다. **인프라 컴포넌트의 운영 권장 설정을 setup-vm.sh 단계에 강제하자.**
