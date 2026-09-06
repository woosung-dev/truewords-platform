<!-- archify 로 생성한 구조 다이어그램 7종의 원본·산출물·재생성 절차. -->
# 아키텍처 다이어그램 7종 — 현재 모노레포 구조 (2026-09-06)

**이 묶음은 main `8980e0c`(2026-09-06, web/admin 분리 컷오버·canonical 전환 이후)의 구조를 그린다.** 2026-09-04 통합 admin/backend 스냅샷은 `docs/archive/diagrams-2026-09-04/` 에 JSON 원본만 보존했고, 당시 HTML/PNG 는 git 이력(`5cb30b5` 이전)에서 볼 수 있다. 다이어그램은 코드·compose·runbook 에서 읽은 사실을 그린 것이며 운영 배포 증거는 [전환·복구 runbook](../../runbooks/monorepo-migration-and-rollback.md)과 [VM 운영](../../../infra/oracle-vm/README.md)을 따른다.

원본은 `.json`, `.html`은 자체 포함 인터랙티브 뷰어(테마 · 검색 · 관계 추적 · guided views · 내보내기), `.png`는 정적 캡처(2048×1320 light)다.

| 다이어그램 | 유형 | 원본 | 산출물 | 근거로 삼은 코드 |
|-----------|------|------|--------|----------------|
| 운영 아키텍처 | architecture | `system-architecture.architecture.json` | `system-architecture.html` · `.png` | `infra/oracle-vm/docker-compose.yml`(6 서비스), `apps/web/next.config.ts` · `apps/admin/next.config.ts`(rewrites), `apps/api/app/main.py`, `apps/api/app/core/common/gemini.py`, `Makefile`(deploy-*), `infra/oracle-vm/{backup-db,ops-check}.sh` |
| 모노레포 구조 | architecture | `repo-structure.architecture.json` | `repo-structure.html` · `.png` | `apps/api/app/{main.py,core,modules}`, `apps/api/alembic/`, `apps/web/src/*`, `apps/admin/src/*`, `packages/*`, `contracts/*`, `tooling/*`, `tests/e2e/*`, `.github/workflows/*`, `turbo.json`, `pnpm-workspace.yaml` |
| 데이터 모델 | architecture | `database-schema.architecture.json` | `database-schema.html` · `.png` | `apps/api/app/modules/{admin,chat,chatbot,datasource}/models.py`, `apps/api/app/modules/pipeline/ingestion_models.py`, `apps/api/app/modules/cache/setup.py` |
| 채팅 요청 시퀀스 | sequence | `chat-request.sequence.json` | `chat-request.html` · `.png` | `apps/web/src/features/chatbot/chat-api.ts`, `packages/api-client-ts/src/index.ts`, `apps/api/app/modules/chat/{router,service}.py`, `apps/api/app/modules/chat/pipeline/stages/*`, `apps/api/app/modules/search/{intent_classifier,query_rewriter}.py`, `apps/api/app/core/config.py` |
| 데이터 적재 | dataflow | `ingestion.dataflow.json` | `ingestion.html` · `.png` | `apps/api/app/modules/admin/{data_router,ingest_worker,ingest_service}.py`, `apps/api/app/modules/pipeline/{chunker,embedder,ingestor}.py` |
| 적재 작업 상태 | lifecycle | `ingestion-job.lifecycle.json` | `ingestion-job.html` · `.png` | `apps/api/app/modules/admin/ingest_service.py`, `apps/api/app/modules/pipeline/{ingestion_models,ingestion_repository}.py` |
| 운영 배포 워크플로 | workflow (schema v2) | `deploy.workflow.json` | `deploy.html` · `.png` | `Makefile`(`deploy-guard` · `deploy-*` · `rollback-*` · `prune-images` · `DEPLOY_LOG`), `infra/oracle-vm/{ops-check,prune-images}.sh`, `infra/oracle-vm/docker-compose.yml`(healthcheck), `.github/workflows/ci.yml`(main push), `docs/runbooks/{ci-cd-pipeline,monorepo-migration-and-rollback}.md` |

architecture 3종은 `meta.repository`(revision `8980e0c`) + 컴포넌트별 `sources`(≤3개)로 코드 경로를 갖고, `--repo-root .` 로 경로 존재를 검증한다. sequence · dataflow · lifecycle · workflow 는 `sources` 필드가 없어 위 표가 근거 목록이다. 배포 워크플로는 Makefile 의 실제 레시피 순서(guard → ops-check → buildx → save|ssh load → .env sed + compose up --wait → deploy.log → prune) 를 그대로 옮겼고, 배포 후 확인 절차는 runbook 의 것이다.

## 2026-09-04 스냅샷에서 바뀐 것

| 영역 | 2026-09-04 | 2026-09-06 |
|---|---|---|
| 프론트 | 통합 `admin` 앱 1개가 채팅 UI + 대시보드, `app.<zone>` 한 origin | `apps/web`(채팅 · 기록 · 소개) + `apps/admin`(대시보드 · 적재 · 분석). `truewords.<zone>` → web, `truewords-admin.<zone>` → admin, `app.<zone>` 은 301 |
| 브라우저 → API | `/api/chat*` · `/admin/*` rewrites | 두 앱 모두 `/api/backend/:path*` → `backend:8080/:path*` (구 경로는 호환 alias) |
| 컨테이너 | 5개 (admin · backend · qdrant · postgres · cloudflared) | 6개 (+ web). Cloudflare Published routes 5 hostname |
| 백엔드 경로 | `backend/main.py`, `backend/src/<domain>` | `apps/api/app/main.py`, `app/core`(설정 · DB · 예외), `app/modules/<10 도메인>`. URL · 테이블 · Alembic head(`a1c9e7d0b2f3`) 는 그대로 |
| 공유 · 계약 | 없음 (admin 수기 DTO) | `contracts/openapi.json` + `contracts/fixtures/chat-stream.json` → `packages/api-client-ts`(generated + transport). `eslint-config` · `typescript-config` |
| CI | `ci.yml`(PR) + `cache-cleanup.yml` | `ci.yml`(PR · main push · dispatch, 변경 감지) → reusable `ci-api` · `ci-web` · `ci-contracts` · `ci-e2e` + `cache-cleanup.yml`. Vercel 제거 |
| 배포 | `make deploy-backend` · `deploy-admin` | `deploy-web` 추가, 3종 모두 `deploy-guard`(HEAD ∈ origin/main + 클린 트리) 선행, 프론트 `compose up --no-deps` |
| 감시 | ops-check 7건 탐지만 | ops-check FAIL/WARN → ntfy.sh 푸시 |
| 다이어그램 종수 | 6종 | 7종 — 배포 워크플로(`deploy.workflow.json`) 신규. TODO P2 의 "전달 파이프라인 다이어그램" 항목 해소 |
| 채팅 · 적재 로직 | — | 변경 없음 (rate limit 20/60s · cache 0.88 · top-50 · rerank 15/12/8 · 700/150 청크 · Queue(100) · 50-point upsert 재확인) |

수치는 이 commit 의 파일 개수(pytest 105 파일 · 스크립트 63 · Playwright 5 spec · Alembic 24 revision · 라우터 9 · 모듈 10) 다. 테스트 케이스 수는 그리지 않았다 — 실행 결과는 CI run 을 본다. Qdrant `417,579 pts` 는 compose 주석 · 운영 문서의 값이며 이번에 재측정하지 않았다.

## 재생성

[archify](https://github.com/tt-a1i/archify) Skill 이 설치돼 있어야 한다 (`~/.claude/skills/archify`, 이번 실행은 2.17.0-dev.1). 레포 루트에서 실행한다.

```bash
A=~/.claude/skills/archify/bin/archify.mjs
D=docs/architecture/diagrams

node $A deliver architecture $D/system-architecture.architecture.json $D/system-architecture.html --quality showcase --repo-root .
node $A deliver architecture $D/repo-structure.architecture.json      $D/repo-structure.html      --quality showcase --repo-root .
node $A deliver architecture $D/database-schema.architecture.json     $D/database-schema.html     --quality showcase --repo-root .
node $A deliver sequence     $D/chat-request.sequence.json            $D/chat-request.html        --quality showcase
node $A deliver dataflow     $D/ingestion.dataflow.json               $D/ingestion.html           --quality showcase
node $A deliver lifecycle    $D/ingestion-job.lifecycle.json          $D/ingestion-job.html       --quality showcase
node $A deliver workflow     $D/deploy.workflow.json                  $D/deploy.html              --quality showcase

# 브라우저 수납 검사 + 스크린샷 (Chrome 필요). 2048x1320 light 캡처를 <name>.png 로 복사하고 사이드카는 지운다.
for name in system-architecture repo-structure database-schema chat-request ingestion ingestion-job deploy; do
  node $A visual-check $D/$name.html
  cp $D/$name.visual-check.2048x1320.light.png $D/$name.png
  rm -f $D/$name.visual-check.*
done
```

`deliver` 는 showcase 프로파일의 아티팩트 검사 9종(스키마 · 라벨 겹침 · 경로 교차 · 코리도 · 경계 따라가기 · 데스크톱 가독성 등)을 통과해야만 HTML 을 커밋한다. 실패하면 이전 HTML 이 보존된다. `visual-check` 는 1440×900 · 2048×1320 을 light/dark 로 실제 Chrome 에서 열어 세로·가로 스크롤 없이 수납되는지와 최소 투영 글자 크기를 측정한다.

구조가 또 바뀌면 JSON 의 topology · `sources` · `meta.repository.revision` 을 먼저 고치고 위 명령을 다시 돈다. PNG 만 고쳐 현재 구조인 것처럼 표시하지 않는다.

## 검증 기록 (2026-09-06, main `8980e0c`)

| 다이어그램 | deliver (showcase) | 수령증 (sha256 앞 12자리) | visual-check |
|-----------|--------------------|---------------------------|--------------|
| system-architecture | pass — 9 checks, errors 0 / warnings 0 | spec `7018598b4c82` · html `91f4b5e27117` (733,258 B) | pass — 4 캡처 무스크롤, 최소 텍스트 6.07px @1440 |
| repo-structure | pass — 9 checks, errors 0 / warnings 0 | spec `f5814275213f` · html `7fc031faa121` (733,980 B) | pass — 4 캡처 무스크롤, 최소 텍스트 7.27px @1440 |
| database-schema | pass — 9 checks, errors 0 / warnings 0 | spec `82bbe132fedc` · html `613f43b7951a` (727,946 B) | pass — 4 캡처 무스크롤, 최소 텍스트 6.15px @1440 |
| chat-request | pass — 9 checks, errors 0 / warnings 0 | spec `167612c97fa0` · html `4c9ae3fc00ce` (717,199 B) | pass — 4 캡처 무스크롤, 최소 텍스트 6.00px @1440 |
| ingestion | pass — 9 checks, errors 0 / warnings 0 | spec `c6ce4d6db421` · html `c07b5aaff0f5` (719,881 B) | pass — 4 캡처 무스크롤, 최소 텍스트 6.27px @1440 |
| ingestion-job | pass — 9 checks, errors 0 / warnings 0 | spec `690d5652ecf5` · html `89e057501594` (712,253 B) | pass — 4 캡처 무스크롤, 최소 텍스트 6.86px @1440 |
| deploy | pass — 9 checks, errors 0 / warnings 0 | spec `36656e33dee6` · html `ae5a565ed1e7` (726,320 B) | pass — 4 캡처 무스크롤, 최소 텍스트 6.73px @1440 |

자동 검사는 기하와 수납만 증명한다. 7장의 2048×1320 light 캡처는 작성 세션에서 이미지로 열어 라벨 겹침 · 경로 · 카드 줄바꿈을 눈으로 확인했다(사람의 재검토를 대체하지 않는다).

## 주의

- 콘텐츠는 한국어이지만 뷰어 UI(버튼 · 범례 제목 · `<html lang>`)는 archify 가 지원하는 로케일이 `en` / `zh-CN` 뿐이라 영어로 고정된다.
- `.visual-check.*` 사이드카(스크린샷 4장 · contact sheet · JSON 수령증)와 `deliver --json` 출력은 커밋하지 않는다. 필요한 캡처 1장만 `<name>.png` 로 남긴다.
- workflow v2 는 좌표가 아니라 `lane`·`col`(0..5) 로 배치하고 viewBox 를 자동 계산한다. 1440×900 수납은 카드 높이가 결정한다 — 카드 3개 × 2항목(2줄) 이 한계였고, 3항목이면 5~21px 넘쳤다. `meta.views[].note` 는 140자 상한.
- 컴포넌트 `sources` 는 스키마상 3개까지다. 150px 노드의 sublabel 은 26 units(CJK 1자 = 2 units), 180px 노드는 31 units 를 넘으면 1440 폭 데스크톱 가독성 검사(6px)에 걸린다 — 긴 정보는 `tag` 로 뺀다.
