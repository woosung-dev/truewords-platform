# 예약 작업이 5일간 조용히 실패한 원인과 대응 ADR

- **작성일**: 2026-07-30
- **상태**: 대응 적용 완료
- **관련**: [CI/CD 파이프라인](../06_devops/ci-cd-pipeline.md) · [VM 운영](../../infra/oracle-vm/README.md) · [Oracle 이전 ADR](2026-07-25-gcp-to-oracle-migration.md)

## 사건

2026-07-24 경부터 `.github/workflows/cache-cleanup.yml` 이 **매일 실패했고 아무도 몰랐다.** 7/29 Oracle 이전 마무리 점검에서 발견했다. 그 사이 semantic_cache 만료 point 가 134개 누적됐다.

응답 정합성에는 영향이 없었다 — 캐시 조회가 Qdrant filter 에서 `created_at >= now - TTL` 로 만료분을 걸러낸다(`src/cache/service.py:89-94`). 만료 point 는 서빙되지 않고 디스크만 차지한다. **다만 그건 이 사건을 무해하게 만든 게 아니라, 하필 이 작업이 무해했을 뿐이다.** 백업이 같은 방식으로 죽었다면 5일간 백업 없이 운영한 것이 된다.

## 왜 5일간 몰랐나 — 증거로 확인한 두 가지

### 1. GitHub 은 알림을 만들지 않았다

"알림이 왔는데 아무도 안 봤다" 를 먼저 의심했다. 아니었다.

```bash
$ gh api notifications --jq 'length'
0
$ gh api "notifications?all=true&per_page=15" --jq '.[] | ...'
(빈 목록)
```

읽은 것까지 포함해 알림 이력 자체가 없다. Actions 실패 통지는 GitHub 알림 인박스가 아니라 이메일 경로로 가고, 그 경로가 이 계정·이 실패 유형에서 작동하지 않았다.

### 2. job 이 시작되지 못하면 워크플로 안의 알림 스텝도 돌지 않는다

이게 핵심이다. 실패한 run 들을 뜯어보면 `steps_count` 가 0 이다.

```bash
$ gh api repos/:owner/:repo/actions/runs/30392911836/jobs \
    --jq '.jobs[] | {name, conclusion, started: .started_at, steps_count: (.steps|length)}'
{"conclusion":"failure","name":"Run cleanup","started":"2026-07-28T19:39:47Z","steps_count":0}
```

annotation 은 이렇다.

> The job was not started because recent account payments have failed or your spending limit needs to be increased

청구 차단은 job 을 **아예 시작하지 않는다.** run 은 `conclusion: failure` 로 기록되지만 스텝은 하나도 실행되지 않는다.

**따라서 "워크플로에 `if: failure()` 알림 스텝을 추가한다" 는 이 사고를 잡지 못한다.** 가장 먼저 떠오르는 대응이 정확히 이 실패 모드에 구조적으로 눈이 먼다. 이 사실을 확인하지 않고 그 스텝만 넣었다면 "고쳤다" 고 믿은 채 같은 사고를 반복했을 것이다.

## 결정

### 감시자는 감시 대상과 다른 실패 도메인에 둔다

이 사건에서 유일하게 정상 작동한 도메인은 **VM cron** 이었다 — 18:00 백업은 그대로 돌았다. 그래서 VM 이 GHA 소유 작업의 결과까지 확인한다.

### "job 이 돌았는가" 가 아니라 "결과가 기대대로인가" 를 본다

liveness 감시(작업이 돌았나)는 세 가지에 눈이 먼다.

| 실패 모드 | liveness 감시 | 결과 감시 |
|---|---|---|
| job 이 실행 중 에러 | 잡는다 | 잡는다 |
| **job 이 아예 시작 안 됨** | **못 잡는다** (이 사고) | 잡는다 |
| **job 이 성공했지만 아무 일도 안 함** | **못 잡는다** | 잡는다 |

세 번째는 가설이 아니다. 같은 점검에서 실제로 발견했다 — `refresh-suggested-questions.yml` 이 Postgres 이전 후에도 낡은 Neon `DATABASE_URL` 로 붙어 **죽은 DB 에 "성공"을 기록**할 상태였다. liveness 로는 영원히 초록이다.

그래서 `infra/oracle-vm/ops-check.sh` 는 불변식을 본다.

| 검사 | 임계 | 근거 |
|---|---|---|
| `backup` | 로컬 최신 덤프 < 8h | 6시간마다(00/06/12/18 UTC) + cron 지연 여유 2h |
| `backup-remote` | Object Storage 최신 사본 < 8h | `backup-db.sh` 는 **업로드 실패를 의도적으로 무시**한다(원격 장애가 로컬 백업까지 실패시키면 안 되니까). 그 관용이 사각지대다 — 로컬은 멀쩡한데 원격만 며칠째 비어도 스크립트는 매번 성공으로 끝난다. VM 유실 시 유일한 복구 지점이라 따로 본다 |
| `cache-ttl` | 만료 ≤ 50건 | 하루 미실행은 통과, 이틀 누적은 걸린다. 스케줄러가 GHA 든 VM 이든 무관하게 결과만 본다 |
| `suggested-q` | `max(suggested_at)` < 10일 | 주기 7일 + 1회 실패 여유. 1회 실패는 `FALLBACK_PROMPTS` 로 노출이 유지된다 |
| `containers` | 4 healthy + cloudflared up | `cloudflared` 는 healthcheck 가 없어 running 만 본다 |
| `disk` | < 80% | Qdrant 세그먼트 병합·이미지 누적 스파이크 여유 |

`backup-remote` 는 **로컬 상태를 함께 봐서 원인을 갈라 준다.** 로컬이 신선한데 원격만 낡았으면 업로드 문제고, 둘 다 낡았으면 백업 자체가 안 도는 것이다. 같은 원인에 두 가지 진단을 내놓으면 엉뚱한 곳을 뒤지게 된다.

VM cron 매일 18:45 (백업 18:00 · 캐시정리 18:00 · 추천질문 일 18:30 뒤). 결과는 `/opt/ops-status.json` 과 `~/truewords-cron.log`.

### 이중 방어 — 두 층이 서로 다른 것을 잡는다

| 층 | 잡는 것 | 못 잡는 것 |
|---|---|---|
| GHA `if: failure()` → Issue | job 이 돌다가 실패 (스크립트 에러, Qdrant 불통, `uv sync` 실패) | **job 미시작** (이 사고) |
| VM `ops-check.sh` | job 미시작, 성공했지만 무효, 인프라 이상 | GHA 실패의 즉시성 (하루 최대 지연) |

Issue 를 택한 이유는 두 가지다. 새 secret 이 필요 없고(`GITHUB_TOKEN`), Actions 실패 통지와 달리 Issue 는 알림이 확실히 만들어진다. 같은 제목의 열린 Issue 가 있으면 코멘트만 남긴다 — 매일 실패할 때 Issue 가 쌓이면 오히려 신호가 묻힌다.

### `set -e` 를 쓰지 않는다

`ops-check.sh` 는 의도적으로 `set -uo pipefail` 만 쓴다. 한 항목이 실패해도 나머지를 끝까지 검사해야 하기 때문이다. `set -e` 면 첫 위반에서 멈춰 "백업이 낡았다" 만 보이고 "디스크가 찼다" 는 다음 날에야 드러난다.

같은 점검에서 `restore-drill.sh` 의 `pg_restore; RC=$?` 가 `set -e` 아래 죽은 코드임을 발견해 고쳤다(PR #209). 방향은 반대지만 같은 함정이다 — **`set -e` 를 켜야 할 곳과 꺼야 할 곳을 구분하지 않으면 둘 다 조용히 잘못 동작한다.**

## 남은 공백 — 정직하게

**VM 쪽 위반은 여전히 push 되지 않는다.** `ops-check.sh` 는 로그·JSON·종료코드를 남기고, 사람이 지나가는 지점(`make ops-check`, `make deploy-*` 전 자동 실행)에서 보이게 했다. 하지만 아무도 배포하지 않는 주에 백업이 죽으면 여전히 늦게 안다.

진짜 push 채널에는 자격증명이 필요하고 현재 레포에는 하나도 없다(`gh api repos/:owner/:repo/hooks` → 0, Slack/SMTP 설정 0건). 선택지는 두 가지이고 둘 다 사용자 조치가 선행된다.

1. **Slack Incoming Webhook** — URL 하나를 VM `.env` 에 넣으면 `ops-check.sh` 마지막에 `curl` 한 줄. 가장 짧다.
2. **OCI Notifications (ONS)** — VM 이 이미 Instance Principal 을 쓰므로 새 키는 없다. 토픽 OCID + IAM 정책이 필요하다.

이 ADR 은 **탐지**를 닫았다. **전달**은 채널이 정해지면 한 줄이다.

## 검증

```
정상 경로   exit 0 · 불변식 5건 전부 OK
실패 경로   BACKUP_MAX_AGE_H=1 EXPIRED_MAX=-1 DISK_MAX_PCT=10
            → FAIL 3건 집계, exit 1, 첫 실패 후에도 나머지 계속 검사
워크플로    YAML 파싱 정상 · permissions {contents:read, issues:write} · 마지막 스텝 if: failure()
cron        VM crontab 3건 (백업 18:00 · 추천질문 일 18:30 · ops-check 18:45)
```

`cache-cleanup.yml` 의 Issue 스텝은 **실제 실행 검증을 못 했다** — GHA 청구 차단이 풀리지 않아 워크플로를 돌릴 수 없다. YAML 파싱과 `gh` 명령 형태만 확인했다. 차단 해소 후 `workflow_dispatch` 로 일부러 실패시켜 확인해야 한다.
