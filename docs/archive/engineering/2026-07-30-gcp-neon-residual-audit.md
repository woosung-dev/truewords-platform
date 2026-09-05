# GCP·Neon 잔존 리소스 감사 — 그리고 발견된 숨은 운영 의존성

- **작성일**: 2026-07-30
- **성격**: 조사 기록 + 삭제 실행 결과. **사용자 승인 후 2건 삭제 완료** (§실행 결과)
- **관련**: [Oracle 이전 ADR](../../adr/2026-07-25-gcp-to-oracle-migration.md) · [GCP 계정 마이그레이션](../../adr/61-gcp-account-migration-jetaime.md)

## 조사 동기

Oracle 이전 후 `docs/TODO.md` 에 "`jetaime-dev` 의 `kairos-api`/`nexus-core`/`kairos-docker`/`nexus-repo` 잔존 리소스 삭제, Neon 프로젝트 정리" 가 남아 있었다. 삭제는 되돌릴 수 없고, 이 프로젝트는 **과거에 프로젝트 삭제로 운영 자산을 잃은 이력이 있다** — 2026-06-04 에 `woosung-dev` 를 지우면서 Qdrant VM 이 소실돼 터널이 530 을 뱉었다. 그래서 지우기 전에 무엇이 남아 있고 무엇이 매달려 있는지 먼저 확인했다.

## ⚠️ 가장 중요한 발견 — 운영 Gemini 키가 문서에 없는 프로젝트에 있다

**서비스의 유일한 외부 의존인 Gemini API 키는 `jetaime-dev` 것이 아니다.** 전혀 다른 계정의 전혀 다른 프로젝트 소유다.

VM `.env` 의 `GEMINI_API_KEY` 를 노출 없이 SHA-256 앞 16자로 대조했다.

| 계정 | 프로젝트 | 키 이름 | 해시 | 운영 키? |
|---|---|---|---|---|
| jangwooseng97@gmail.com | **`d-project-497004`** ("D-Project") | Gemini API Key | `2ece17462fabcce1` | ✅ **일치** |
| jetaime.jang@gmail.com | `jetaime-dev` | DEV Gemini API Key | `d4a732cba247152a` | ❌ |
| jetaime.jang@gmail.com | `gen-lang-client-0703926046` | Gemini 결제 API Key | `4ddf1b284b1779ee` | ❌ |
| jetaime.jang@gmail.com | `gen-lang-client-0798243559` | (없음) | — | — |

**`d-project-497004` 를 지우거나 그 키를 회수하면 챗봇이 즉시 죽는다.** 이름이 "D-Project" 라 TrueWords 와 아무 연관이 없어 보이고, 계정도 인프라 작업에 쓰던 `jetaime.jang` 이 아닌 `jangwooseng97` 이다. 어떤 문서에도 적혀 있지 않았다.

`woosung-dev` 사고가 정확히 이 구조에서 났다 — "안 쓰는 프로젝트" 로 보였지만 운영 자산이 살아 있었다. 같은 사고의 재료가 하나 더 있었던 셈이다.

→ `infra/oracle-vm/.env.example` 과 `README.md` 에 소유 프로젝트를 명시했다.

## `jetaime-dev` 실사

**TODO 에 적힌 잔존 리소스는 이미 없다.** 그리고 과금이 이미 꺼져 있다.

| 항목 | 결과 |
|---|---|
| 과금 | **비활성** — Compute/Artifact Registry API 가 billing 게이트로 거부 |
| Cloud Run 서비스 | **0개** (`kairos-api`/`nexus-core` 없음) |
| Cloud SQL 인스턴스 | **0개** |
| Storage 버킷 | **0개** |
| Artifact Registry | **조회 불가** — billing 비활성이라 API 거부. 리포지토리가 남아 있을 수 있으나 과금되지 않는다 |
| 활성 API | `artifactregistry` / `compute` / `run` / `sqladmin` — API 활성화 자체는 무료 |
| API 키 | "DEV Gemini API Key" 1개 (운영 미사용, 위 표 참조) |

**월 비용 $0 이다.** 남겨 두는 비용이 없고, 지우는 이득도 정리 뿐이다.

Artifact Registry 잔여물을 확인·삭제하려면 과금을 다시 켜야 한다. 과금을 켜고 지우고 다시 끄는 것은 얻는 것보다 실수 여지가 크다 — **그대로 두는 쪽이 낫다.**

## Neon 실사

```
host: ep-dark-meadow-a4tf2vx6.us-east-1.aws.neon.tech
DNS: 해석됨 → 프로젝트 살아 있음
```

Neon 무료 티어라 **비용은 $0** 이다. 다만 여기 남은 것이 비용 문제가 아니다.

**2026-05-03 cutover 시점의 운영 DB 사본이 그대로 있다.** 체험단 참여자의 실제 대화 본문(`session_messages`)과 참여자 식별 정보(`research_sessions.participant_name`)가 포함된다. 쓰지 않는 곳에 실사용자 데이터 사본을 방치하는 것은 비용이 아니라 **데이터 최소화** 문제다.

VM Postgres 가 단일 진실 공급원임은 검증됐다 — 복구 리허설이 11개 테이블 34,395행 차집합 0 으로 PASS 했고(2026-07-30), 6시간마다 백업 + Object Storage 90일 사본이 돈다. **Neon 사본이 복구 경로에 필요하지 않다.**

## 결론과 권고

| 대상 | 비용 | 위험 | 권고 |
|---|---|---|---|
| `d-project-497004` | — | **높음 — 지우면 챗봇 즉사** | **절대 삭제 금지.** 문서에 명시 완료 |
| `jetaime-dev` | $0 | 낮음 (운영 의존 없음 확인) | 삭제는 선택. 남겨도 비용 없음 |
| Neon 프로젝트 | $0 | 낮음 | **삭제 권고** — 비용이 아니라 실사용자 데이터 사본 정리 |

## 실행 결과 (2026-07-30, 사용자 승인 후)

### Neon `truewords` 삭제 — 대상 특정이 핵심이었다

조사에서 Neon 계정에 **프로젝트가 7개** 있고 여럿이 살아 있음을 발견했다. `ffwpu-social-db` 는 삭제 작업 몇 분 전에도 갱신됐고 `vibe-core-services`·`familyfed` 도 최근 활동이 있었다. "Neon 프로젝트 정리" 를 이름만 보고 실행했다면 살아 있는 DB 를 지웠을 수 있다.

VM `.env` 의 `NEON_DATABASE_URL_BACKUP` 호스트와 각 프로젝트의 엔드포인트를 대조해 대상을 확정했다.

```
VM 보존 호스트 : ep-dark-meadow-a4tf2vx6.us-east-1.aws.neon.tech
truewords      : ep-dark-meadow-a4tf2vx6.us-east-1.aws.neon.tech   ✅ 일치
```

`rapid-mode-95348531` (`truewords`, 70MB, 2026-04-04 생성, 최종 갱신 2026-07-29T14:24 = 이전 검증 시점) **하나만** 삭제했다. 삭제 후 6개 남았고 나머지는 전부 그대로다. 호스트 DNS 도 미해석으로 전환됐다.

### GCP `jetaime-dev` 삭제

삭제 직전에 API 키 대조를 다시 했다. **첫 재확인은 무효였다** — 운영 키 쪽은 `tr -d '\r\n'`, GCP 키 쪽은 파이프로 넘겨 개행이 포함돼 정규화가 어긋났고, 같은 키라도 절대 일치하지 않는 비교였다. `printf '%s'` 로 양쪽을 통일해 다시 하니 앞선 감사와 같은 해시가 나왔다.

```
운영 키          2ece17462fabcce1
jetaime-dev 키   d4a732cba247152a  (DEV Gemini API Key)  → 운영 키 아님
VM .env 내 jetaime 참조 0건 · GitHub Secrets GCP_* 0건
```

`gcloud projects delete jetaime-dev` → `DELETE_REQUESTED`. **30일 복구 창**이 있어 `gcloud projects undelete jetaime-dev` 로 되돌릴 수 있다.

### 삭제 후 운영 검증

| 검사 | 결과 |
|---|---|
| `api.woosung.dev/health` | 200 |
| `app.woosung.dev/login` · `/api/chatbots` | 200 |
| **채팅 SSE 실제 호출** | `chunk` + `sources` + `done` — **Gemini 키 정상** |
| `ops-check.sh` | 불변식 6건 전부 OK |

`d-project-497004` 는 손대지 않았다.

## 후속 제안 — Gemini 키 유효성 감시

서비스의 유일한 외부 의존이고, 키가 문서에 없던 별 계정 프로젝트에 있고, 회수되면 챗봇이 죽는다. 그런데 이걸 확인하는 장치가 없다. `ops-check.sh` 에 하루 1회 최소 토큰 호출을 넣으면 키 회수·할당량 소진을 조용히 지나치지 않는다. 비용은 무시할 수준이다.

이번 범위에는 넣지 않았다 — 별도 판단이 필요하다.

## 조사 방법 메모

`gcloud` 활성 설정을 바꾸지 않았다. 두 계정을 넘나들어야 했지만 사용자의 활성 config 를 건드리면 다음 작업이 엉뚱한 프로젝트를 향한다. `CLOUDSDK_ACTIVE_CONFIG_NAME` 을 명령 단위 env 로만 넘겼다.

```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=quantbridge gcloud projects list   # jetaime.jang
CLOUDSDK_ACTIVE_CONFIG_NAME=default     gcloud projects list   # jangwooseng97
```

키 대조는 값을 출력하지 않고 SHA-256 앞 16자만 비교했다. 로그·전사에 비밀값이 남지 않는다.
