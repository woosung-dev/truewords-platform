# ADR 61: GCP 계정/프로젝트 마이그레이션 — `woosung-dev` → `jetaime-dev`

- **일자:** 2026-05-19
- **상태:** 적용 완료 (구 리소스는 2026-05-21+ 정리 예정)
- **결정자:** 사용자
- **관련:** PR #185 (cutover 트리거 commit), `.github/workflows/deploy.yml`

## Context

기존 production 백엔드는 GCP 계정 `jangwooseng97@gmail.com` 의 프로젝트 `woosung-dev` (asia-northeast3) 에서 운영되어 왔다. 같은 프로젝트에 **별개 워크로드 `kairos-api` / `kairos-api-v2`** 가 공존하고 있어, billing / IAM / 리소스 라벨이 섞이는 문제가 있었다. 사용자는 truewords 만 별도 Google 계정 (`jetaime.jang@gmail.com`) + 새 billing account + 신규 프로젝트 (`jetaime-dev`) 로 분리하기로 결정했다.

## Decision

**새 GCP 계정에 truewords 전용 새 프로젝트를 생성하고, 코드 변경 없이 GitHub Secrets 3개 교체만으로 cutover** 한다.

가능했던 이유:
- `deploy.yml` 이 모든 GCP 식별자 (`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`) 를 secret 참조로 추상화하고 있어 코드 변경 0건.
- 모든 시크릿(DB / Qdrant / Gemini / JWT)이 GitHub Secrets → Cloud Run `--set-env-vars` 직접 주입 방식 → Secret Manager 마이그레이션 불필요.
- DB (Neon), Qdrant (셀프호스팅 VM + Cloudflare Tunnel), Gemini, Vercel 은 모두 GCP 외부 SaaS/리소스라 영향 0.

대안으로 (a) 프로젝트 자체를 새 organization 으로 이전, (b) 기존 프로젝트에 새 계정의 IAM 만 추가 도 검토했으나 둘 다 kairos 와의 격리에 실패하거나 billing 분리가 어려워 채택하지 않았다.

## Implementation

### 사전 셋업 (2026-05-19 cutover 당일)

1. 새 Google 계정으로 콘솔 로그인 → billing account `015FAD-6B9CB6-2A2CB5` 생성 → 프로젝트 `jetaime-dev` (번호 `780943117571`) 생성 + billing 연결.
2. `gcloud auth login` 후 컨피그 분리 (`default` = 구 / `quantbridge` = 신).
3. 새 프로젝트에 다음을 생성:
   - **API 활성화**: `run`, `artifactregistry`, `iamcredentials`, `sts`, `cloudresourcemanager`
   - **Artifact Registry**: `truewords-docker` (asia-northeast3)
   - **서비스 계정**: `github-actions-sa@jetaime-dev.iam.gserviceaccount.com`
   - **SA 프로젝트 IAM**: `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`
4. Workload Identity Federation:
   - 기존 pool/provider (`github-pool` / `github-provider`, `repository_owner == 'woosung-dev'` 조건) 재사용.
   - SA 에 `roles/iam.workloadIdentityUser` 를 `principalSet://...attribute.repository/woosung-dev/truewords-platform` 으로 바인딩.
5. GitHub Secrets 갱신 (3개만):
   - `GCP_PROJECT_ID = jetaime-dev`
   - `GCP_SERVICE_ACCOUNT = github-actions-sa@jetaime-dev.iam.gserviceaccount.com`
   - `GCP_WORKLOAD_IDENTITY_PROVIDER = projects/780943117571/locations/global/workloadIdentityPools/github-pool/providers/github-provider`

### Cutover (PR #185 머지)

- `.github/workflows/deploy.yml` 헤더에 cutover 주석 3줄만 추가 (path filter `backend/**` 또는 `deploy.yml` 매치 위함).
- main 머지 직후 Deploy workflow 자동 실행 → 새 프로젝트의 Artifact Registry 에 이미지 푸시 → Cloud Run `truewords-backend` 신규 생성.

### Outcome

- **새 Cloud Run URL**: `https://truewords-backend-imrsiyibaa-du.a.run.app`
- 서비스 상태: `Ready=True`, `ConfigurationsReady=True`, `RoutesReady=True`
- `/health` 200 OK
- Vercel `truewords-admin` 의 Production `NEXT_PUBLIC_API_URL` 을 새 URL 로 교체 후 Redeploy → admin 챗봇 정상 응답 확인

## Rollback

- 구 프로젝트 `woosung-dev` 의 Cloud Run `truewords-backend` 및 Artifact Registry `truewords-docker` 는 **2026-05-21 (cutover +48h)** 까지 그대로 유지.
- 새 환경에 문제 발견 시 (a) GitHub Secrets 3개를 구 값으로 되돌리고 (b) Vercel `NEXT_PUBLIC_API_URL` 을 구 URL `https://truewords-backend-467254555861.asia-northeast3.run.app` 으로 되돌리면 즉시 회귀.

## Cleanup (예정, 2026-05-21+)

48시간 안정 확인 후 구 `woosung-dev` 의 truewords 잔재만 선택 삭제:

```bash
gcloud config configurations activate default
gcloud run services delete truewords-backend --region=asia-northeast3 --project=woosung-dev
gcloud artifacts repositories delete truewords-docker --location=asia-northeast3 --project=woosung-dev
```

**금지:** `gcloud projects delete woosung-dev` — kairos-api / kairos-api-v2 가 같이 살아 있으므로 프로젝트 자체 삭제 금지. truewords 관련 Secret Manager 항목도 kairos 가 참조하는지 grep 확인 후 선별 삭제.

## 학습

- **secret 참조 추상화의 위력**: deploy 파이프라인이 처음부터 GCP 식별자를 secret 으로 빼놓은 덕에 *코드 0줄 변경* 으로 GCP 계정 이전이 가능했다. 향후 외부 자원 식별자는 항상 secret/env 로 추상화해야 한다.
- **Secret Manager 보다 GitHub Secrets 직접 주입**의 마이그레이션 비용이 명백히 낮았다. 단, 시크릿 회전 정책이 필요해지면 재검토 대상.
- WIF pool/provider 의 `repository_owner` 조건은 owner 산하 모든 repo 에 통과되지만, principalSet 단계에서 `attribute.repository/<owner>/<repo>` 로 좁히면 실효 보안은 동일하다.
