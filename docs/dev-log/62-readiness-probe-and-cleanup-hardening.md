# ADR 62: Qdrant 터널 장애 감지 — `/readyz` 프로브 + cleanup 워크플로우 강건화

- **일자:** 2026-06-04
- **상태:** 적용 (브랜치 `fix/qdrant-readyz-cleanup-hardening`)
- **관련:** `.github/workflows/cache-cleanup.yml`, `backend/main.py`, ADR 61(GCP 마이그레이션), `docs/07_infra/qdrant-self-hosting.md`

## Context

2026-06-04, 스케줄 워크플로우 **Semantic Cache Cleanup (run #33)** 이 실패했다.
`cleanup_semantic_cache.py` 가 Qdrant `points/count` 호출에서 **HTTP 530
(Cloudflare Tunnel Error 1033)** 을 받고 의도대로 exit 1 했다.

조사 결과 `qdrant.woosung.dev` 는 CI 시점뿐 아니라 **조사 시점(7시간 경과)까지도
530** 이었다. 일시 장애가 아니라 Qdrant VM 의 cloudflared 커넥터가 오프라인
(VM 다운 또는 컨테이너 정지) 인 지속 장애다.

확산 범위가 cleanup CI 에 그치지 않는다:

- 운영 Cloud Run 의 `QDRANT_URL` 은 cleanup 워크플로우와 **동일한 GitHub Secret**
  이다 (`deploy.yml:83` ↔ `cache-cleanup.yml:60`). 둘 다 `qdrant.woosung.dev`.
- `/health` 는 `{"status":"ok"}` 만 반환하는 liveness 체크라 (`main.py`) Qdrant
  상태와 무관하게 200 을 준다.
- 따라서 같은 장애 동안 운영 `/chat` RAG 검색도 Qdrant 에 못 닿았을 것이다.
  **cleanup CI 실패가 사실상 유일한 감지 신호였고, 7시간 동안 그 외엔 보이지 않았다.**

### ADR 61 의 분류 오류 (latent)

ADR 61 은 GCP 계정 마이그레이션을 "코드 0줄 변경" 으로 정리하면서
DB/Qdrant/Gemini/Vercel 을 "모두 GCP 외부 SaaS/리소스라 영향 0" (line 19) 으로
분류했다. **그러나 Qdrant 는 GCP 외부가 아니라 GCP VM** (`qdrant-server`,
e2-medium, asia-northeast3-a — `docs/07_infra/qdrant-self-hosting.md`) 이다.
구 프로젝트 `woosung-dev` 에 위치했고, "구 리소스 2026-05-21+ 정리" 과정에서
`gcloud projects delete woosung-dev` 가 실행돼 프로젝트가 **DELETE_REQUESTED** 로
들어가면서 그 안의 Qdrant VM 이 정지된 것이 **확정 원인**이다 (ADR 61 이 명시적으로
금지한 명령). 같은 프로젝트의 kairos-api/v2(quantbridge) 도 동반 다운됐다.

### 복구 결과 (2026-06-04)

- woosung-dev `undelete` + billing 재연결로 프로젝트 복구. 단 부트 디스크가 30분+
  RESTORING 으로 지연 → 디스크 클론 포기.
- **로컬 fallback**: 로컬 Qdrant 의 `malssum_poc_v5` 가 운영과 동일 규모(417,579).
  jetaime-dev 에 새 `qdrant-server` VM provision → **기존 Cloudflare 터널 토큰 재사용**
  (`qdrant.woosung.dev` 유지, `QDRANT_URL`/`QDRANT_API_KEY` 시크릿 불변) →
  `migrate_cloud_to_vm.py` 로 로컬 → 새 VM 이전(417,579 == 417,579 검증).
- 운영 `/chat` 출처 3건 정상 복구. **Qdrant 운영 VM 이 jetaime-dev 로 이전됨**
  (구 woosung-dev 아님). 상세: 메모리 `project_qdrant_vm_relocation_jetaime`.
- 학습: ADR 61 의 "GCP 외부" 가정 오류가 프로젝트 삭제로 이어졌다. 외부 자원도 그것이
  **무엇 위에서 도는지**(SaaS vs self-host VM) 구분해 의존성 인벤토리에 명시해야 한다.

## Decision

**(1) 인프라 복구는 운영 작업** (코드 영역 밖). VM/cloudflared 재기동은
`docs/07_infra/qdrant-self-hosting.md` "일상 운영 / 문제 해결" 절차로 수행한다.

**(2) 같은 장애를 다음에는 코드 신호로 즉시 감지** 하도록 두 가지 방어를 추가한다.

### `GET /readyz` readiness 프로브

`/health`(liveness) 와 분리된 별도 엔드포인트. Qdrant 도달 + main 컬렉션 존재를
실제로 확인한다.

- 도달 실패 → `503 {"status":"unavailable","qdrant":"unreachable"}`
- 컬렉션 부재 → `503 {"status":"unavailable","qdrant":"collection_missing"}`
- 정상 → `200 {"status":"ready"}`
- 짧은 timeout(5s/connect 3s) — 의존성 장애 시 빠르게 실패해야 모니터가 즉시 감지.
- 내부 예외 repr 은 응답에 노출하지 않고 서버 로그로만 (Cloudflare 에러 HTML 등 외부 노출 방지).

`/health` 를 건드리지 않은 이유: Cloud Run liveness 프로브가 `/health` 를 본다면,
Qdrant 다운 시 컨테이너가 계속 재시작되는 역효과가 난다. readiness 는 별 엔드포인트로 분리.

> 활용(후속): uptime 모니터를 `/readyz` 로 지정하거나 Cloud Run startup probe 를
> `/readyz` 로 wire 하면 Qdrant 장애가 자동 알림으로 이어진다. Postgres 까지
> 확인하도록 확장 가능(현재는 이번 장애 범위인 Qdrant 만 점검).

### cleanup 워크플로우 재시도 + 명확한 알림

`cache-cleanup.yml` 의 실행 스텝을 3회 재시도(30s 간격) 로 감싼다.

- 터널 재연결 등 짧은 blip 으로 daily 작업이 false-fail 하지 않게 흡수.
- 3회 모두 실패(지속 장애) 면 그대로 exit 1 → 빨간 X 로 알림 유지.
- 최종 실패 시 `::error::` 로 "Qdrant 도달 불가 추정, 터널/VM 점검" + 런북 경로를
  찍어 다음 대응을 명확히 한다.

## Alternatives 검토

- **`/health` 자체에 Qdrant 체크 추가** — 기각. liveness 프로브가 의존성 장애에
  컨테이너를 죽이는 역효과.
- **워크플로우 실패 시 GitHub Issue/웹훅 알림** — 보류. 새 secret/알림 인프라 필요.
  현 단계에선 `/readyz` + 빨간 X 로 충분, 필요 시 후속.
- **무한/장기 재시도** — 기각. 지속 장애를 숨겨 감지를 늦춤. 3회 상한 후 fail-loud.

## Consequences

- `/readyz` 회귀 테스트 3건 추가 (`tests/test_api.py`): 정상 200 / 도달 실패 503 /
  컬렉션 부재 503 + 내부 에러 미노출 검증.
- 코드 변경은 `backend/main.py`(엔드포인트) + `cache-cleanup.yml`(재시도) 2파일.
- 이번 outage 자체는 코드로 못 고친다 — VM/터널 복구는 운영 액션(TODO 참조).

## Follow-up

- [ ] **(인프라, 사용자)** `qdrant-server` VM/cloudflared 복구 → `qdrant.woosung.dev`
      200 확인 → cleanup CI 재실행(green) → 운영 `/chat` 검증.
- [ ] ADR 61 의 "Qdrant = GCP 외부" 분류 정정(또는 본 ADR 로 상호 참조) — Qdrant VM 이
      어느 프로젝트에 있는지 확정 후 인프라 의존성 문서 갱신.
- [ ] (선택) uptime 모니터 → `/readyz` 지정, 또는 Cloud Run startup probe wire.
