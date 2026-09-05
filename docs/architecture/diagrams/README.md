<!-- archify 로 생성한 구조 다이어그램 6종의 원본·산출물·재생성 절차. -->
# 아키텍처 다이어그램 — 분리 이전 스냅샷

**이 묶음은 2026-09-04의 통합 admin/backend 구조를 보존한다.** 2026-09-05 web/admin/API 분리 이후 구조나 운영 배포 완료 증거가 아니다. 새 경계는 [모노레포 설계](../2026-09-05-pwa-flutter-monorepo.md)와 [루트 README](../../../README.md)를 따른다.

원본은 `.json`, `.html`은 자체 포함 인터랙티브 뷰어, `.png`는 정적 캡처(2048×1320 light)다. 6종의 파일명·JSON/HTML/PNG 내용은 문서 이전 시 보존했다. JSON의 `sources`에 있는 `backend/`·`admin/`도 당시 코드 경로다.

| 다이어그램 | 유형 | 원본 | 산출물 | 근거로 삼은 코드 |
|-----------|------|------|--------|----------------|
| 운영 아키텍처 | architecture | `system-architecture.architecture.json` | `system-architecture.html` · `.png` | `infra/oracle-vm/docker-compose.yml`, `admin/next.config.ts`, `backend/main.py`, `backend/src/common/gemini.py`, `Makefile` |
| 데이터 모델 | architecture | `database-schema.architecture.json` | `database-schema.html` · `.png` | `backend/src/{admin,chat,chatbot,datasource}/models.py`, `backend/src/pipeline/ingestion_models.py`, `backend/src/cache/setup.py` |
| 레포 구조 | architecture | `repo-structure.architecture.json` | `repo-structure.html` · `.png` | `backend/main.py`, `admin/src/app/*`, `admin/src/lib/*`, `.github/workflows/*` |
| 채팅 요청 시퀀스 | sequence | `chat-request.sequence.json` | `chat-request.html` · `.png` | `backend/src/chat/service.py`, `backend/src/chat/router.py`, `backend/src/chat/pipeline/stages/*`, `admin/src/features/chatbot/chat-api.ts` |
| 데이터 적재 | dataflow | `ingestion.dataflow.json` | `ingestion.html` · `.png` | `backend/src/admin/{data_router,ingest_worker,ingest_service}.py`, `backend/src/pipeline/{chunker,embedder,ingestor}.py` |
| 적재 작업 상태 | lifecycle | `ingestion-job.lifecycle.json` | `ingestion-job.html` · `.png` | `backend/src/admin/ingest_service.py`, `backend/src/pipeline/{ingestion_models,ingestion_repository}.py` |

architecture 3종은 `meta.repository` + 컴포넌트별 `sources`로 당시 코드 경로를 갖는다. `--repo-root` 경로 검증은 기준 commit `94755c7`을 checkout한 별도 worktree에서 실행해야 한다. 현재 모노레포에 실행하면 옛 코드 경로가 없어 실패하는 것이 정상이다.

## 재생성

[archify](https://github.com/tt-a1i/archify) Skill 이 설치돼 있어야 한다 (`~/.claude/skills/archify`). **아래는 기준 commit의 별도 worktree에서 당시 결과를 재생성하는 명령**이다. 현재 monorepo 결과를 만들려면 별도 승인 작업에서 JSON의 topology·sources를 먼저 갱신해야 한다.

```bash
A=~/.claude/skills/archify/bin/archify.mjs
D=docs/04_architecture/diagrams

node $A deliver architecture $D/system-architecture.architecture.json $D/system-architecture.html --quality showcase --repo-root .
node $A deliver architecture $D/database-schema.architecture.json     $D/database-schema.html     --quality showcase --repo-root .
node $A deliver architecture $D/repo-structure.architecture.json      $D/repo-structure.html      --quality showcase --repo-root .
node $A deliver sequence     $D/chat-request.sequence.json            $D/chat-request.html        --quality showcase
node $A deliver dataflow     $D/ingestion.dataflow.json               $D/ingestion.html           --quality showcase
node $A deliver lifecycle    $D/ingestion-job.lifecycle.json          $D/ingestion-job.html       --quality showcase

# 브라우저 수납 검사 + 스크린샷 (Chrome 필요). 2048x1320 light 캡처를 <name>.png 로 복사한다.
for name in system-architecture database-schema repo-structure chat-request ingestion ingestion-job; do
  node $A visual-check $D/$name.html
  cp $D/$name.visual-check.2048x1320.light.png $D/$name.png
done
```

`deliver` 는 showcase 프로파일의 아티팩트 검사 9종(라벨 겹침 · 경로 교차 · 코리도 · 데스크톱 가독성 등)을 통과해야만 HTML 을 커밋한다. 실패하면 이전 HTML 이 보존된다. `visual-check` 는 1440×900 · 1600×1000 · 1920×1080 · 2048×1320 에서 세로 스크롤 없이 수납되는지 실제 Chrome 으로 측정한다.

## 검증 기록 (2026-09-04, main `94755c7`)

| 다이어그램 | deliver (showcase) | visual-check |
|-----------|--------------------|--------------|
| system-architecture | pass — 9 checks, errors 0 / warnings 0 | pass — 4 viewports 수납, 최소 텍스트 7.05px @1440 |
| database-schema | pass — 9 checks, errors 0 / warnings 0 | pass — 4 viewports 수납, 최소 텍스트 6.59px @1440 |
| repo-structure | pass — 9 checks, errors 0 / warnings 0 | pass — 4 viewports 수납, 최소 텍스트 6.52px @1440 |
| chat-request | pass — 9 checks, errors 0 / warnings 0 | pass — 4 viewports 수납, 최소 텍스트 6.00px @1440 |
| ingestion | pass — 9 checks, errors 0 / warnings 0 | pass — 4 viewports 수납, 최소 텍스트 6.27px @1440 |
| ingestion-job | pass — 9 checks, errors 0 / warnings 0 | pass — 4 viewports 수납, 최소 텍스트 6.86px @1440 |

자동 검사는 기하와 수납만 증명한다. 그림이 뜻을 제대로 전달하는지는 사람이 HTML 을 열어 봐야 한다.

## 주의

- 콘텐츠는 한국어이지만 뷰어 UI(버튼 · 범례 제목 · `<html lang>`)는 archify 가 지원하는 로케일이 `en` / `zh-CN` 뿐이라 영어로 고정된다.
- 이 묶음은 역사적 스냅샷으로 보존한다. 새 구조 그림은 별도 묶음으로 만들고 JSON→HTML→PNG를 함께 검증한다. 옛 그림의 PNG만 고쳐 현재 구조인 것처럼 표시하지 않는다.
- `.visual-check.*` 사이드카(스크린샷 4장 · contact sheet · JSON 수령증)는 커밋하지 않는다. 필요한 캡처 1장만 `<name>.png` 로 남긴다.
