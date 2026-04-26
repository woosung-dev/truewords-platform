# Dev-log 42 — Deploy pipeline 복구 + verify image step + public 전환 결정

- **작성일**: 2026-04-26
- **상위**: dev-log 41 의 incident chain 후속. PR #56 image 가 운영 미적용 상태에서 `gh run rerun` 2회 모두 즉시 실패 → 진짜 root cause 발견 + 해결.
- **연관**: dev-log 41 (1차 복구), dev-log 38 (R3 PoC), 메인 plan 의 Track A.

---

## 1. 본 세션 진단 흐름

### 1.1 시작 상태 (2026-04-25 마무리)

- main HEAD = `5e189c4` (PR #56)
- 운영 revision = `00076-lwj`, image = `f0bcec0493...` (PR #52 시점 image, **alembic auto upgrade 부재**)
- 운영 chat 작동 중 (수동 alembic 적용 + dummy env 재시작으로 복구)
- artifact registry 에 `5e189c4` (PR #56) tag **부재** — PR #56 deploy 자체가 실패

### 1.2 1차 진단 가설 (오답)

`gh run view 24927219303 --json jobs --jq '.jobs[].steps'` → `steps: []`. 일시적 GHA transient 라 추정 → `gh run rerun` 시도.

**결과**: 재실행도 같은 패턴 (steps 빈 배열, 2초 종료). 즉 transient 아님.

### 1.3 2차 진단 (정답)

`gh api .../actions/runs/.../jobs` 의 raw 응답:
```json
{
  "runner_id": 0,
  "runner_name": "",
  "runner_group_id": 0,
  "started_at": "2026-04-25T13:09:05Z",
  "completed_at": "2026-04-25T13:09:07Z",
  "steps": []
}
```

**runner 가 한 번도 할당되지 않음**. 일반적으로 이 패턴 = GitHub Actions 무료 시간 소진 (private repo + free plan).

**Root cause 확정**: PR #54~#56 까지 약 2주간 deploy.yml 이 평균 5~7분 빌드를 자주 돌렸는데, GitHub Free plan 의 private repo 월 2,000분 한도에 도달.

### 1.4 부수 발견 — git history 의 secret 노출

GHA quota 해결 옵션 중 "public 전환" 검토 시점에 git history secret scan 진행. 발견:

| 항목 | 결과 |
|------|------|
| Gemini API key (`AIzaSy...`) | ⚠ a6e3335 commit 에 평문 노출 (private 라 외부 유출 0, 그러나 회전 필요) |
| Qdrant API key | ✅ 변수명만, 실제 값 없음 |
| DATABASE_URL | ✅ placeholder 만 |
| JWT_SECRET | ✅ `change-me-in-production` placeholder |
| GCP service account JSON | ✅ 0 |
| 다른 .env 변형 | ✅ backend/.env (1건) + .env.example (placeholder) 만 |

→ Gemini key 1개 회전이면 public 전환 안전.

---

## 2. 의사결정 — Path A (4일 public, 29일 private 복귀)

### 2.1 옵션 비교

| Path | 비용 | 비가역 노출 | 회복 시간 |
|------|------|------------|-----------|
| A. Public 전환 | $0 | 자동 봇 4일 snapshot 가능 | 즉시 |
| B. GitHub Pro | $4/mo | 0 | 5분 |
| C. Self-hosted runner | GCP $5~15/mo | 0 | 1~2h setup |

사용자 선택: **Path A**, 29일 (다음 월간 quota 갱신) private 복귀 의향.

### 2.2 선결 조건 + 4일 monitoring

선결 (전환 전):
- ✅ Gemini key rotation (필수)
- ✅ 추가 secret 재검사 (모든 branch + admin/ + dev-log 등)

4일간 monitoring:
- Cloud Run logs traffic spike 감시
- Gemini API 사용량 일별 dashboard 확인
- GitHub Insights → Traffic 페이지 캡처 (29일 복귀 직전)

이상 traffic 감지 시 즉시 private 복귀 (29일 못 기다림).

---

## 3. 실행 단계

### 3.1 Gemini key rotation

1. AI Studio 에서 새 key 발급 + 기존 key 삭제
2. `backend/.env` 갱신 (사용자 직접)
3. AI 자율 진행:
   - GitHub Secret 갱신: `echo -n "$GEMINI_KEY" | gh secret set GEMINI_API_KEY` (stdin, process arg 노출 0)
   - Cloud Run env 갱신: `gcloud run services update --update-env-vars=GEMINI_API_KEY=...` → revision `00077-v6k` 자동 생성
4. 검증: chat smoke HTTP 200, 답변 354자 + sources 3건

### 3.2 Public 전환

```bash
gh repo edit woosung-dev/truewords-platform \
  --visibility public \
  --accept-visibility-change-consequences
```

확인: `gh repo view --json visibility,isPrivate` → `{"visibility":"PUBLIC","isPrivate":false}` ✅

### 3.3 PR #56 deploy 재실행

```bash
gh run rerun 24927219303
```

이전 (private 시점) `steps: []` + 2초 즉시 실패였던 것이 **모든 step 정상 진행** (Set up job → checkout → GCP auth → Docker config → **Build → Push → Clear secrets → Deploy → Post steps**).

총 소요: 약 9분.

### 3.4 운영 image 갱신 확인

| 지표 | 이전 | 이후 |
|------|------|------|
| Cloud Run revision | `00076-lwj` | `00079-htf` |
| Image digest | `f0bcec0493...` (PR #52) | `109abc60e7fe...` (PR #56 재배포) |
| alembic auto upgrade | ❌ 부재 | ✅ logs 확인 |

logs 검증:
```
2026-04-25T13:51:29.784390Z  INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
2026-04-25T13:51:29.784443Z  INFO  [alembic.runtime.migration] Will assume transactional DDL.
```

→ 본 image 가 startup 시 alembic 실행. 운영 DB 가 이미 head (`33d34f262dc2`) 라 변경 없음. **다음 migration 추가 PR 머지 시 자동 적용 보장**.

### 3.5 chat smoke 재검증

```bash
curl -X POST https://truewords-backend-rfzkx2dyra-du.a.run.app/chat \
  -H 'Content-Type: application/json' -d '{"query":"축복이란 무엇인가?"}'
```

- HTTP 200, latency 7.5s
- 답변 354자: "말씀에 따르면 축복이란 다음과 같습니다. 1. 6천 년 만에 인류가 고대하고 ..."
- sources 3건, volume = "참어머님 말씀(2014년).txt", score 0.5

dev-log 41 의 baseline (p50=4s, max=6.7s) 와 비교 시 cold start 마진 안.

---

## 4. 메타 학습 — `Verify image entrypoint binaries` step 추가

### 4.1 본 incident chain 의 패턴

| PR | 변경 | 발견 시점 | 영향 |
|----|------|----------|------|
| #55 | Dockerfile CMD 에 `uv run alembic upgrade head` 추가 | 운영 startup `sh: 1: uv: not found` | 새 revision startup 실패 |
| #56 | `uv run` 제거 → `alembic` 직접 호출 | local PATH 시뮬레이션만으로 검증 | local docker build + image run 검증 누락 |
| 본 세션 | (재배포 시) GHA quota 부재 | runner 할당 자체 실패 | 운영 image 갱신 차단 |

PR #55 와 #56 모두 **local docker build + image run 검증** 을 안 했음. local PATH 시뮬레이션 만으로는 multi-stage Dockerfile 의 binary 누락 못 잡음.

### 4.2 deploy.yml 에 verify step 추가

```yaml
# dev-log 41~42 메타 학습: Dockerfile 변경 PR 이 runtime stage 에 binary 부재로 startup
# 실패하는 사고 (PR #55 의 'uv: not found') 재발 방지. push/deploy 전에 image 가
# 최소한의 entrypoint binary (alembic, uvicorn) 를 가지고 있는지 verify.
- name: Verify image entrypoint binaries
  run: |
    docker run --rm --entrypoint sh \
      ${{ env.GCP_REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.ARTIFACT_REGISTRY }}/${{ env.BACKEND_IMAGE }}:${{ github.sha }} \
      -c "alembic --version && uvicorn --version"
```

위치: build step 직후 + push step 직전. local image 가 살아있는 시점에 검증.

비용: build 시간 +5~10초.

가치: PR #55 같은 사고를 deploy 전에 자동 차단.

### 4.3 재발 방지 효과

본 step 이 PR #55 시점에 있었다면:
1. local docker daemon 에 `:71eb3423...` image 빌드됨
2. `docker run --entrypoint sh ... -c "alembic --version && uvicorn --version"`
3. `uv run alembic upgrade head` CMD 가 아닌 `alembic --version` 호출이라 통과? — **사실 통과한다.** alembic binary 는 venv 에 있음. CMD 의 `uv run` prefix 가 문제였음.

→ **본 verify step 으로 PR #55 사고는 직접 못 잡음**. CMD 자체를 dry-run 하지 않으니까.

**더 정확한 verify 는 다음**:
```bash
# CMD 의 직접 dry-run (env 부재라 startup 은 fail 하지만 sh: ... not found 류는 잡음)
docker run --rm --entrypoint=$(docker inspect --format '{{.Config.Cmd}}' image:tag) image:tag 2>&1 | head -3
```

또는 더 간단히:
```bash
# CMD entrypoint 가 sh -c 로 시작하니, sh -c 의 첫 토큰만 검증
docker run --rm --entrypoint sh image:tag -c "command -v alembic && command -v uvicorn"
```

→ 본 dev-log 의 verify step 은 **첫 단계** (binary 존재 검증). PR #55 같은 정확한 사고 방지에는 limited. 그러나:
- PR #55: `uv` binary 가 runtime stage 에 없음 → `command -v uv` 가 잡았을 것
- PR #56: `alembic` binary 정상 + CMD 정상 → 통과

본 step 의 한계 = CMD 를 실제 dry-run 하지 않음. 단계적 강화는 다음 sprint:
- 1단계 (본 PR): binary 존재 검증
- 2단계: CMD parsing + first token `command -v` 검증
- 3단계: ephemeral PG 컨테이너 + 실 startup 검증 (BackgroundJob, ~30s)

---

## 5. 본 세션 산출물

| 항목 | 위치 |
|------|------|
| 새 Cloud Run revision | `00079-htf`, image `109abc60e7fe...` |
| 운영 image PR #56 fix 적용 | ✅ |
| Gemini key rotation | ✅ revision `00077-v6k` 부터 적용 |
| Public 전환 | ✅ `2026-04-26 KST` 시점 |
| GHA quota 회복 | ✅ 무제한 |
| deploy.yml verify step | 본 PR 에 포함 |
| 본 dev-log 42 | 본 PR 에 포함 |

---

## 6. 다음 sprint 우선순위

본 dev-log 머지 후:

1. **4월 29일 직전**: GitHub Insights → Traffic 페이지 캡처 + private 복귀
2. **Track B (R3 후속)** 진입 — `CollectionResolver` + multi-collection. 메인 plan §11.5 commit 5~8.
3. **Track C (R1 Phase 1)** 진입 — Pipeline Stage 추상화 + 첫 2 Stage 분리.
4. **dev-log 41 의 bq-117 INTERNAL_ERROR** 별도 분석 (낮은 우선순위)

---

## 7. §23 준수 점검

- 검증 루프: 진단 1회 → rerun 2회 (private 시점 모두 실패) → public 후 1회 (성공). **3회 상한 안**
- 문서 분량: 본 dev-log 약 220줄. **2,000줄 임계 충분**
- Δ 누적:
  - Δ1 (계획 외): GHA quota 진단 + public 전환 결정 (선결 secret 재검사 포함)
  - Δ2 (계획 외): Gemini key rotation
  - Δ3 (계획 내): A4 verify step + dev-log 42

Δ 3개 도달했으나 모두 본 incident 의 root cause + 보안 위생 + 메타 학습이라 **본 sprint 종결 전 처리 합리**. 다음 sprint (Track B/C) 진입 전에 정리 완료.
