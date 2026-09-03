# 아키텍처 다이어그램 (archify)

현행 코드에서 검증한 사실로 그린 탐색형 다이어그램이다. 각 항목은 **JSON 원본**(진실 원점), **HTML**(단독 실행 뷰어 — 테마 전환 · 검색 · 노드 포커스 · 관계 추적 · PNG/SVG 내보내기), **PNG**(1440×900 라이트 테마 스크린샷) 세 파일로 구성된다.

> HTML 은 GitHub 에서 바로 렌더되지 않는다. 클론 후 브라우저로 열거나, PNG 를 먼저 본다. 뷰어 UI 문구는 영어(archify 고정), 도식 내용은 한국어다.

| 다이어그램 | 종류 | 무엇을 보여주나 | 원본 근거 |
|---|---|---|---|
| [system-architecture](./system-architecture.html) ([PNG](./system-architecture.png)) | architecture | 운영 배포 토폴로지 — 브라우저 → Cloudflare Tunnel → Oracle VM 컨테이너 5개 → Gemini · Object Storage, 배포·cron 경로 | `infra/oracle-vm/docker-compose.yml`, `admin/next.config.ts`, `Makefile` |
| [code-structure](./code-structure.html) ([PNG](./code-structure.png)) | architecture | 코드 모듈 구조 — admin 라우트 그룹 · features · rewrites ↔ backend 라우터 · Stage 체인 · search · cache · 적재 · Qdrant 클라이언트 · 저장소 | `backend/main.py`, `backend/src/**`, `admin/src/**` |
| [database-schema](./database-schema.html) ([PNG](./database-schema.png)) | architecture | PostgreSQL 11 테이블의 FK 관계 + Qdrant 컬렉션 2개 (도메인별 경계) | `backend/src/*/models.py`, `backend/alembic/versions/` |
| [chat-request](./chat-request.html) ([PNG](./chat-request.png)) | sequence | `POST /chat/stream` cache-miss 정상 경로 — Stage 체인이 Gemini · Qdrant · PostgreSQL 을 부르는 순서와 SSE 이벤트 | `backend/src/chat/service.py`, `chat/pipeline/stages/` |
| [ingestion](./ingestion.html) ([PNG](./ingestion.png)) | dataflow | 관리자 업로드 → 단일 워커 → 추출 · 청킹 → 임베딩(dense + sparse) → Qdrant upsert, `ingestion_jobs` 체크포인트 | `backend/src/admin/ingest_service.py`, `pipeline/ingestor.py` |
| [ingestion-job](./ingestion-job.html) ([PNG](./ingestion-job.png)) | lifecycle | `IngestionJob` 상태 전이 — PENDING → RUNNING → COMPLETED / PARTIAL / FAILED, 재업로드 재개 · skip 단축 | `backend/src/pipeline/ingestion_repository.py` |

## 재생성

archify 는 로컬 스킬(`~/.claude/skills/archify`)이며 npm 설치가 필요 없다. JSON 을 고친 뒤:

```bash
cd ~/.claude/skills/archify
node bin/archify.mjs validate <type> <name>.<type>.json --quality showcase --json      # 9 artifact checks, 0 errors, 0 warnings
node bin/archify.mjs deliver  <type> <name>.<type>.json <name>.html --quality showcase --json
node bin/archify.mjs visual-check <name>.html --json                                  # 1440×900 ~ 2048×1320 containment + 스크린샷
```

- `system-architecture` 와 `code-structure` 는 `meta.repository` (커밋 SHA 고정) + 컴포넌트별 `sources` 로 레포 증거를 싣는다. 이 경우 `validate` / `deliver` 에 `--repo-root <레포 루트>` 를 붙여야 Git 이 커밋·파일·라인을 검증한다.
- `visual-check` 가 만드는 사이드카(다른 해상도 PNG, `.visual-check.html/.json`) 는 커밋하지 않는다. 라이트 1440×900 PNG 만 `<name>.png` 로 남긴다.
- `system-architecture` 와 `code-structure` 는 1440×900 뷰포트에 스크롤 없이 들어간다(`visual-check` pass). 나머지 4종은 노드·메시지 수가 많아 세로 스크롤이 생긴다 — 내용을 덜어내는 대신 스크롤을 택했다.
- 코드가 바뀌어 사실이 달라지면 JSON 을 먼저 고친다. HTML/PNG 는 산출물이다.

## 갱신 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-04 | 6종 최초 작성 — main `94755c7` 기준 사실 수집 (6개 리더 에이전트, 파일:라인 근거) → archify showcase 검증 → 사실/가독성 2중 검토 |
| 2026-09-04 | 6종 완결 — `code-structure` 신규 작성, `system-architecture`·`ingestion`·`ingestion-job` 지오메트리 수리. 전부 showcase 9/9 · 0 errors · 0 warnings, PNG 6장 갱신 |
