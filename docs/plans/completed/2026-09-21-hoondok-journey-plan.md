# PLAN-HD-005 — 훈독 끊긴 여정 잇기

> **이 문서는 실행 프롬프트다.** 사람이 읽는 계획서이면서, 그대로 LLM 에이전트에게 넘기면
> 추가 설명 없이 착수할 수 있도록 자립형으로 썼다. Claude·Codex·Cursor 등 어떤 도구로 실행해도
> 된다. 아래 §0 을 먼저 읽고, 맡은 트랙의 절만 읽으면 된다.
>
> - 상태: **완료 · 운영 배포됨(2026-09-22).** T0~T7 전 트랙 구현·검증 완료 후 main `a425217` 로
>   backend·admin·web 3서비스 배포. 증거는 [rollout runbook §2026-09-22](../../runbooks/hoondok-pwa-rollout.md).
>   남은 것은 코드가 아니라 **운영 입력**이다 — `content_rights` 0행이라 서고가 비어 있고,
>   admin `/hoondok/rights` 승인 전까지 서고·검색·원문이 사용자에게 보이지 않는다(설계상 기본 비노출)
> - 착수 시 상태: 구현 승인 · 진행 중. 2026-09-21 사전 점검·제품 결정 반영 후 사용자 구현 요청
> - 기준 커밋: main `7abc4ef`
> - 선행 문서: [`PLAN-HD-001`](../active/2026-09-17-hoondok-mvp.md) · [`PLAN-HD-002`](../active/2026-09-19-hoondok-screens.md) · [`PLAN-HD-004`](../active/2026-09-20-hoondok-followup-3tracks.md)
> - 표기: 라벨 없는 문장은 **코드로 확인한 사실**이다. `[가정]` 은 검증이 필요한 추론,
>   `[확인 필요]` 는 사용자·외부 결정이 필요한 항목이다

---

## 0. 실행자에게 — 먼저 읽을 것

### 0.1 이 프로젝트가 무엇인가

- **레포**: `truewords-platform` (pnpm + Turborepo 모노레포)
- **앱**: `apps/web`(Next.js 16, 사용자 웹) · `apps/admin`(Next.js 16, 관리자) · `apps/api`(FastAPI, uv)
- **데이터**: PostgreSQL + Qdrant(`malssum_poc_v5`, 417,579 청크) + Gemini
- **훈독(hoondok)**: `apps/web` 안의 `/hoondok/*` 라우트로 사는 PWA. 종교 텍스트를 매일 아침
  3분 읽는 습관 앱이다. 기능 플래그 `NEXT_PUBLIC_HOONDOK_ENABLED` 뒤에 있고 운영에서 ON 이다.
- **언어 규칙**: 사고·대화·문서·주석은 한국어, 코드 네이밍은 영어.

### 0.2 지금 무엇이 문제인가 (한 문단)

화면은 17개가 다 만들어져 있는데 **여정은 한 줄기만 이어져 있다** — 홈 → 훈독하기 → 완료.
홈의 "오늘의 실천 3가지" 중 2장은 매일 회색이고, 편성이 없는 날은 "내일 아침에 다시 열어 주세요"
로 끝나며, AI 질문의 근거 말씀에서 원문으로 갈 길이 없고, 탭 "말씀"·"가정예배"는 운영에서
비활성이다. 이 계획은 **끊긴 여정을 잇는다.**

### 0.3 절대 하지 말 것

1. **프로토타입과 다른 값을 만들지 않는다.** 토큰·간격·색·반경의 원본은
   `docs/prd/prototypes/hoondok-ds/app.html` + `hoondok.css` 다. 디자인 스킬의 제안이
   프로토타입과 다르면 **프로토타입을 따른다.**
2. **없는 것을 있는 것처럼 쓰지 않는다.** 코퍼스가 화자·판본을 주지 않으면 칸을 비우지 말고
   `REQ-PWA-012` 대로 **"확인되지 않음"** 이라고 적는다. 지어내지 않는다.
3. **AI 가 말씀 본문을 생성하지 않는다.** 말씀은 언제나 코퍼스 원문을 **추출**한 것이다
   (`AC-023-01`). 생성 LLM 호출 금지.
4. **스크린샷·비교 산출물을 커밋하지 않는다.** 구현과 관련 명세는 같은 세션에 갱신한다. 결정은 이 문서
   §9 에 1~2줄로만 남긴다.
5. **다른 트랙의 파일을 건드리지 않는다.** §6 파일 소유 표가 절대 규칙이다. 필요하면
   보고만 하고 오케스트레이터가 처리한다.
6. **배포하지 않는다.** `make deploy-*` 는 이 계획의 범위 밖이다.
7. **`main` 에 직접 커밋·푸시하지 않는다.** push·PR 생성은 사용자 승인 뒤에만.

### 0.4 확정 결정 6건 (2026-09-21 인터뷰, 재논의 불필요)

| # | 항목 | 확정값 |
|---|---|---|
| 1 | 화면 감사 범위 | **프리뷰 라우트 집중.** 실데이터 9라우트는 `PLAN-HD-004` 감사분을 신뢰하고 재감사하지 않는다 |
| 2 | 기능 갭 착수 | 정성 맞춤 말씀(`AC-023-01`) · 클라이언트 오류 수집 · 말씀 서고·검색 실데이터화 |
| 3 | 미결 UI 결정 | 추천안대로 일괄 반영 (§5 T5) |
| 4 | 권리 게이트 | **권리 원장 최소 신설.** 저작물 단위 allow-list + admin 화면. 기본 전부 비노출 |
| 5 | 정성 편성 시점 | **매일 조회 시점 lazy 생성 후 저장** |
| 6 | 말씀 3화면 운영 노출 | **프리뷰 플래그 밖으로 꺼내 정식 노출.** 가정예배 4 + 가족 1 은 프리뷰 유지 |

---

### 0.5 실행 전 추가 확정

- 홈 미션 카드는 원본 프로토타입을 유지하고 펼침 UI는 보류한다. 훈독하기는 즉시 완료, 말씀 읽기는 서고 진입 후 원문 하단 읽음, 기도하기는 비활성이다.
- 정성은 기존 7·21·40일 달력 종료일과 `read` 진도 기준이다. 결석 시 연장·순서 기반 진도를 도입하지 않는다.
- 권리 원장은 신규 서고·검색·원문·정성 말씀에 적용한다. 기존 AI 답변·전체 편성의 전면 권리 전환은 후속이다.
- 자동 추출 정성 말씀을 사람의 검수 완료로 표시하지 않는다.

## 1. 사용자 여정 — 지금 끊기는 곳

각 줄의 "근거" 는 실제 코드에서 확인한 것이다. 착수 전에 해당 파일을 열어 눈으로 확인하라.

| # | 여정 | 지금 끊기는 곳 (근거) | 메우는 트랙 |
|---|---|---|---|
| J1 | 첫 방문 → 훈독 → 가입 → 소급 | **이어져 있다.** 손대지 않는다 | — |
| J2 | 매일 아침, 홈의 "오늘의 실천 3가지" | `home-missions.tsx:53-72` — 3장 중 **2장이 `isDisabled`**. 3번째 카드는 글자 그대로 `title="말씀 서고"` · `meta="서고·이어 읽기는 다음 단계에서"` 다. 사용자는 매일 회색 카드 2장을 본다 | **T7** |
| J3 | 편성이 없는 날 | `malssum-card.tsx:42` 가 **"서고·검색은 준비 중이에요. 내일 아침에 다시 열어 주세요."** 라고 말하고 끝난다. 앱을 떠나는 것 말고 할 일이 없고, 서고가 열리는 순간 이 문장은 **거짓말이 된다** | **T7** |
| J4 | AI 질문 → 답 → 근거 말씀 | `ask-detail.tsx:194-207` 이 근거를 `<p className="scripture">` 본문으로만 보인다. `source.chunk_id`·`source.volume` 을 이미 들고 있는데 **원문으로 가는 링크가 없다** | **T2b** |
| J5 | 말씀을 찾고 싶다 | 탭 "말씀" 이 `tabs.ts` 의 `TAB_STAGE.library="preview"` 라 운영에서 **비활성**이다. 검색 0건 문구도 `"지금은 예시 말씀 한 편에서만 찾을 수 있어요"` 로 프리뷰 전제다 | **T2b** |
| J6 | 정성을 시작했다 | 정성 기간이 **진행률 숫자만** 바꾼다. 읽는 말씀은 전체 편성 그대로라 "나를 위한 기간" 이라는 약속이 화면에서 지켜지지 않는다 | **T3a·T3b·T7** |
| J7 | 가정예배·가족을 눌렀다 | fixture 프리뷰라 제출이 "준비 중" 에서 멈춘다. `DEC-PWA-020`·`021` 대기라 이번에 열지 않는다 — 대신 **막다른 골목을 정직하게** 만든다 | **T1** |

### 1.1 이 계획이 만드는 새 여정 고리

```
편성 없는 날 ──→ "서고에서 읽어 보세요" ──→ 서고 ──→ 원문 ──→ [말씀 읽기] 미션 완료
                                              ↑                        ↓
AI 질문 ─→ 답 ─→ 근거 말씀 ─→ "원문 보기" ────┘              홈 3장 중 2장 점등
                                              ↑
검색 ─────────────────────────────────────────┘

정성 시작 ─→ 매일 주제에 맞는 말씀 ─→ 훈독 완료 ─→ n/N일 진도
```

### 1.2 공짜로 얻는 것

`apps/api/app/modules/hoondok/models.py:19` 에 이미 있다:

```python
MISSION_KINDS = ("read", "pray", "study")  # 훈독하기 · 기도하기 · 말씀 읽기
```

`study`("말씀 읽기")는 **백엔드가 이미 지원한다.** `POST /hoondok/missions/study/complete` 가
지금도 201 을 낸다. 서고가 실데이터가 되는 순간 홈 3번째 카드를 **백엔드 변경 0 으로** 켤 수
있다. `pray` 는 대응 화면이 없어 계속 비활성이다.

---

## 2. 현황 — 착수 전에 아는 사실

### 2.1 라우트 17개

| 구분 | 라우트 | 데이터 |
|---|---|---|
| 실데이터 9 | `/hoondok` · `/read` · `/onboarding` · `/offline` · `/garden` · `/settings` · `/ask` · `/ask/log` · `/ask/[id]` | API |
| 프리뷰 8 | `/library` · `/search` · `/words/[id]` · `/worship` · `/worship/challenge/[id]` · `/worship/sermons` · `/worship/request` · `/family` | fixture |

프리뷰 8은 `NEXT_PUBLIC_HOONDOK_PREVIEW` 뒤에 있고, 이 플래그는 **Dockerfile·Makefile 에
배선되지 않아** 운영 이미지에서 항상 OFF(404) 다.

### 2.2 이미 검증되고 있는 것 (다시 하지 말 것)

- `tests/e2e/hoondok-preview.spec.ts` 가 프리뷰 8라우트 × {390, 1280} 에서
  **200 · 가로 넘침 0 · 콘솔 오류 0 · noindex · 백엔드 요청 0** 을 단언한다.
- `tooling/checks/hoondok-css.mjs` 가 `:root` 0 · 토큰 블록 밖 hex 0 ·
  `@media` 브레이크포인트 ⊆ {768, 1024, 1224} 를 강제한다.
- `.col` 의 콘텐츠 폭은 `hoondok.css:587` 의 `.col { max-width: var(--measure-app) }` 가
  **전역으로** 잡는다. "미디어 쿼리가 없다 = 데스크톱이 깨진다" 는 성립하지 않는다.
- 기준선: pytest **1069** passed / 4 skipped / 1 xfailed · web Vitest **222** / 26 files ·
  admin Vitest 116 · api-client 13 · Playwright **85** passed.
  → 새 수치를 이 값으로 복사하지 말고 **실행 결과만** 적는다.

### 2.3 재사용할 기존 코드

| 대상 | 경로 | 쓰임 |
|---|---|---|
| 추출형 후보 판정 | `apps/api/app/modules/hoondok/candidates.py` | 정성 말씀 뽑기의 카드 적합성·출처 라벨·제목/화자 제안 규칙 그대로 |
| 하이브리드 검색 | `apps/api/app/modules/search/hybrid.py` `hybrid_search()` | 말씀 검색·정성 말씀. `source_filter` 는 이미 있고 `volume_filter` 만 추가 |
| Qdrant 원시 클라이언트 | `apps/api/app/modules/qdrant/raw_client.py` `facet`·`scroll`·`count`·`retrieve` | 저작물 전수 목록 · 원문 페이지 읽기 |
| 원문 청크 조회 | `apps/api/app/modules/datasource/chunks_router.py` (`GET /api/sources/chunks/{id}`) | 원문 뷰의 단일 청크 경로 선례 |
| admin 편성 화면 | `apps/admin/src/features/hoondok/` + `app/(dashboard)/hoondok/` | 권리 원장 화면을 같은 `fetchAPI`·폼 패턴으로 |
| 감사 로그 | `admin_service.log_audit` | 권리 상태 변경 기록 |
| 검색 실패 503 | `core/common/exception_handlers.py` `search_failed_handler` | `GET /hoondok/search` 가 그대로 씀 — 새 핸들러 불필요 |
| rate limit | 같은 파일 `rate_limit_handler` + `config.py` `rate_limit_max_requests` | 익명 POST 방어 |
| 빈 상태 규격 | `app/(hoondok)/hoondok/offline/page.tsx` | `.empty`(아이콘 26 · 제목 · 본문 · `empty__cta`) 의 기준 구현 |
| 미션 완료 훅 | `features/hoondok/use-missions.ts` | 비로그인 localStorage → 로그인 후 소급 패턴 |

---

## 3. 화면 구현에 쓰는 스킬

### 3.1 스킬 선택표

| 스킬 | 언제 | 무엇을 얻나 | 제약 |
|---|---|---|---|
| **`taste-skill:soft-skill`** | 모든 UI 트랙(T1·T2b·T3b·T7) 착수 직후 | 간격·그림자·카드 구조·모션의 "비싸 보이는" 기본값, 흔한 싸구려 패턴 차단 | **주력 보조.** 새 폰트·색·반경 제안은 전부 버린다 |
| **`ui-ux-pro-max:ui-ux-pro-max`** | 빈 상태·오류·로딩·폼·CTA 설계할 때 | 99개 UX 가이드라인, 상태 패턴, 접근성 | 같은 제약. 컴포넌트 라이브러리 추천은 무시(shadcn 미사용 앱이다) |
| `design-review` (gstack) | 각 UI 트랙 **머지 직후** | 시각 불일치·간격·위계·AI slop 탐지 후 수정 | 프로토타입 대조 결과와 충돌하면 프로토타입 우선 |
| `qa` (gstack) | §8 여정 워크스루 | 웹앱 체계적 QA + 발견 버그 수정 | 브라우저는 §4 규약을 따른다 |
| `browse` (gstack) | 빠른 단일 화면 확인 | 헤드리스 브라우저 QA | 정밀 대조는 Playwright MCP 로 |
| `codex` (gstack) | §8 게이트 4 | 독립 리뷰 | 반드시 `exec -s read-only` |
| `vercel-react-best-practices` | T3b 의 RSC↔클라이언트 경계 판단 시 | React/Next 성능 패턴 | 이 판단은 §5 T3b 에 이미 결론이 있다. 근거 확인용 |
| `archify` | 필요 없다 | | 다이어그램은 이 계획 범위 밖 |
| ~~`taste-skill:taste-skill`~~ | **쓰지 않는다** | 랜딩·포트폴리오용 스킬 | 그 스킬 자신의 §13 "OUT OF SCOPE" 에 제품 UI·대시보드가 명시돼 있다 |
| ~~`frontend-design:frontend-design`~~ | **쓰지 않는다** | 새 비주얼 방향 정하기 | 방향은 `DEC-PWA-017`(A 아침 햇살, 라이트 고정)로 **확정**됐다 |

### 3.2 모든 UI 브리프에 그대로 붙일 제약 5줄

> 1. 값은 `docs/prd/prototypes/hoondok-ds/app.html?screen=<id>` + `hoondok.css` 가 원본이다.
>    스킬 제안이 프로토타입과 다르면 **프로토타입을 따른다.**
> 2. 새 폰트·색·그림자·모서리 반경을 만들지 않는다. `hoondok.css` 토큰만 쓴다
>    (`tooling/checks/hoondok-css.mjs` 가 `:root` 0 · 토큰 밖 hex 0 ·
>    브레이크포인트 ⊆ {768, 1024, 1224} 를 검사한다).
> 3. 모션은 4종만 — 시트 220ms · 체크 150ms · 프레스 120ms · 토글 150ms.
>    `prefers-reduced-motion` 에서 0.
> 4. 아이콘은 `lucide-react`, 크기는 14·20·22·24·26·28 중 하나.
> 5. 라이트 단일 테마. 다크 팔레트·`.dark` 분기 금지(`DES-PWA-003` 상태 줄).

### 3.3 브리프에 반드시 넣을 한 줄

각 UI 트랙 브리프에 **그 트랙이 닫는 여정 번호(J2~J7)** 를 명시한다. 에이전트가 "화면 하나"가
아니라 **"어디서 와서 어디로 가는 화면"** 인지 알아야 CTA·빈 상태·되돌아갈 곳을 제대로 만든다.

---

## 4. 브라우저 검증 규약

### 4.1 도구 선택

| 도구 | 언제 | 비고 |
|---|---|---|
| **`mcp__playwright__*`** | **기본값.** 프로토타입 대조·반응형·computed style·상태 재현 | 헤드리스, 결정론적, 스크립트 가능 |
| `mcp__claude-in-chrome__*` | 사용자가 옆에서 같이 볼 때, 실제 로그인 세션이 필요할 때 | 사용자의 실제 Chrome. 세션 시작 시 `tabs_context_mcp` 를 **먼저** 부른다. 새 탭을 만들고, 이전 세션의 탭 ID 를 재사용하지 않는다 |
| `terminal-browser` 스킬 | 사용자에게 화면을 바로 보여줄 때 | 터미널을 분할해 옆에 띄운다 |
| `browse` 스킬 (gstack) | 빠른 단발 확인 | |

**주의**: `alert`·`confirm`·`prompt` 를 띄우는 요소를 클릭하지 않는다. 모달 다이얼로그가 뜨면
브라우저 자동화가 통째로 멈춘다. 훈독에는 해당 요소가 없지만 admin 삭제 버튼류는 조심한다.

### 4.2 로컬 검증 스택 세우기 (재현 명령)

```bash
# 1) 격리 인프라 (postgres :15432 · qdrant :16333)
docker compose -f apps/api/docker-compose.e2e.yml up -d --wait

# 2) 스키마 + 시드
cd apps/api
export ENVIRONMENT=development GEMINI_API_KEY=e2e-fixture-no-external-llm \
  ADMIN_JWT_SECRET=e2e-only-not-a-production-secret COOKIE_SECURE=false \
  DEMO_ADMIN_EMAIL=demo-admin@example.com \
  DATABASE_URL=postgresql+asyncpg://truewords:truewords@127.0.0.1:15432/truewords_e2e \
  QDRANT_URL=http://127.0.0.1:16333 ADMIN_FRONTEND_URL=http://localhost:3001 \
  WEB_FRONTEND_URL=http://127.0.0.1:3000 EMBED_BATCH_SLEEP=0.001
uv run alembic upgrade head
uv run python scripts/create_admin.py demo-admin@example.com test1234
uv run python scripts/create_admin.py admin@test.com test1234
uv run python scripts/seed_chatbot_configs.py
uv run python scripts/seed_daily_readings.py
uv run python scripts/seed_hoondok_user.py hoondok@example.com test1234 --name 시드식구
uv run python scripts/seed_hoondok_journey.py

# 3) API (:8000)
uv run uvicorn e2e_app:app --app-dir tests --host 127.0.0.1 --port 8000

# 4) web (:3000, 플래그 2개 ON) — 저장소 루트의 별 터미널
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_HOONDOK_ENABLED=1 NEXT_PUBLIC_HOONDOK_PREVIEW=1 \
pnpm --filter @truewords/web dev

# 5) admin (:3001) — 별 터미널, 저장소 루트
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_DEMO_ADMIN_EMAIL=demo-admin@example.com \
pnpm --filter @truewords/admin dev

# 6) 정본 프로토타입 (:4173) — 나란히 대조용, 별 터미널
python3 -m http.server 4173 -d docs/prd/prototypes/hoondok-ds
```

- 로그인 계정: `hoondok@example.com` / `test1234`
- 정본 프로토타입 주소: `http://127.0.0.1:4173/app.html?screen=<id>`
  (`id` = `today`·`read`·`garden`·`settings`·`ask`·`ask-log`·`ask-detail`·`library`·`search`·
  `words`·`worship`·`challenge`·`sermons`·`sermon-request`·`family`·`onboarding`)
- **주의**: Qdrant 컨테이너는 비어 있다. 말씀 검색·정성 말씀을 실데이터로 보려면 별도 코퍼스가
  필요하므로 §4.5의 테스트 코퍼스를 시드한다. 빈 결과와 성공 경로를 모두 실제 HTTP로 검증한다.
  운영 Qdrant 를 로컬 개발에 붙이지 않는다.

### 4.3 Playwright MCP 대조 시퀀스

한 화면당 이 순서를 돌린다.

```
1. mcp__playwright__browser_navigate      → http://127.0.0.1:3000/hoondok/<경로>
2. mcp__playwright__browser_resize        → 375 / 768 / 1280 각각
3. mcp__playwright__browser_take_screenshot
4. 같은 폭으로 프로토타입(:4173/app.html?screen=<id>) 을 열어 3번 반복 → 나란히 비교
5. mcp__playwright__browser_evaluate      → 아래 스니펫으로 computed style 대조
6. mcp__playwright__browser_console_messages → 앱 레벨 오류 0 확인
7. mcp__playwright__browser_network_requests → 프리뷰 화면은 /api/backend 요청 0
8. mcp__playwright__browser_emulate_media  → prefers-reduced-motion: reduce 로 재확인
```

**가로 넘침 측정** (`browser_evaluate`):

```js
() => document.documentElement.scrollWidth - document.documentElement.clientWidth
```

**프리미티브 computed style 대조** (`browser_evaluate`, 구현·프로토타입 양쪽에서 같은 값을 받아 비교):

```js
() => Object.fromEntries(
  ['.card','.btn','.sect__title','.mission','.badge','.empty__title','.notice']
    .map(sel => {
      const scope = document.querySelector(`[data-screen="${new URLSearchParams(location.search).get("screen")}"]`) ?? document;
      const el = [...scope.querySelectorAll(sel)].find(node => node.getClientRects().length > 0);
      if (!el) return [sel, null];
      const s = getComputedStyle(el);
      return [sel, {
        font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`,
        pad: s.padding, radius: s.borderRadius,
        color: s.color, bg: s.backgroundColor, border: s.border,
      }];
    })
)
```

**모션 정지 확인** (`browser_emulate_media` 로 `prefers-reduced-motion: reduce` 를 건 뒤):

```js
() => [...document.querySelectorAll('*')]
  .map(el => getComputedStyle(el).animationName)
  .filter(n => n && n !== 'none')
```
→ 스피너 2종을 뺀 장식 모션은 전부 사라져야 한다.

### 4.4 대조 결과 기록 규칙

- 차이를 **문장으로** §9 에 적는다. 스크린샷은 커밋하지 않는다(§0.3-4).
- **차이가 없으면 "차이 없음" 을 그대로 적고 코드를 건드리지 않는다.** 고칠 것을 만들어 내지 않는다.
- 프로토타입이 값을 주지 않는 화면(예: `/hoondok/offline`)은 `.empty` 규격만 따르고
  "정본에 대응 화면 없음" 이라고 적는다.

---

### 4.5 성공 경로 시드·도구 준비

- 잠금 파일 기준 pnpm·uv 의존성, Qdrant·oasdiff 이미지 및 기준 백엔드 이미지를 준비한다.
- 전용 `tw-monorepo-e2e`의 PostgreSQL 15432·Qdrant 16333만 사용한다. 기존 개발 DB·볼륨은 변경하지 않는다.
- `tests/e2e_app.py`에서만 deterministic dense/sparse embedding을 대체하고 실제 HTTP·인증·PG·Qdrant 권리 필터를 검증한다.
  운영 플래그를 추가하지 않는다. 허용·미허용·철회·검색 전용 저작물, 20청크 초과 원문, 정성 후보 2개 이상을 시드한다.
- 관리자·챗봇·훈독 사용자·오늘 편성을 함께 시드하며 API는 `e2e_app:app`, web/admin은 3000/3001을 사용한다.
  테스트 전용 시계 또는 과거 날짜 이력으로 KST 날짜 변경을 재현한다. 실제 하루를 기다리지 않는다.
- MCP·고정 포트 E2E는 검증 담당 한 명만 사용한다. 스크린샷은 허용 경로 `.playwright-mcp`에 저장하고 커밋하지 않는다.
- 프로토타입 computed style은 활성 `[data-screen]` 안의 **보이는** 요소만 비교하고 폰트 로드를 기다린다.
  숨겨진 첫 `.card`를 측정하지 않는다. 프로토타입 favicon 404는 앱 오류와 구분한다.

## 5. 트랙

의존: `T2a(공개 API 포함) → {T2b, T3a}` · `T3a → T3b` · `{T2b, T3b} → T7 → T4`.
`T1`·`T5` 는 독립이라 즉시 병렬. `T6` 는 마지막.

### T0 — 선행 조사 (완료, 코드 변경 없음; 결과는 §9.3)

`RawQdrantClient.facet(key="volume", exact=True)` 로 **저작물 전수 목록**을 뽑아 다음 3개를 답한다.

1. 실제 distinct `volume` 값은 몇 개인가? (문서에 "88권" 과 "665 파일" 두 수치가 있어 미확정)
2. 같은 `volume` 문자열에 **다른 `book_series`** 가 붙는 충돌이 있는가?
   → 있으면 권리 원장 키를 `(volume, book_series)` 복합으로 올린다.
3. 한 `volume` 의 평균·최대 청크 수는? → 원문 뷰의 페이지 크기를 여기서 정한다.

`volume` 과 `source` 는 `pipeline/ingestor.py:59 _REQUIRED_PAYLOAD_INDEXES` 라 인덱스가 있다.
`book_series`·`chunk_index` 는 인덱스가 없다.

> **결과를 §9 에 적고 나서 T2a 를 시작한다.** 이 답이 스키마를 바꾼다.

---

### T1 — 프리뷰 5화면 품질 보정 (독립, 즉시) · 닫는 여정 **J7**

대상: `/hoondok/worship` · `/worship/challenge/[id]` · `/worship/sermons` · `/worship/request` ·
`/family` **5개**. 말씀 3화면은 T2b 가 실데이터와 함께 다시 그리므로 제외한다.

§2.2 가 이미 잡는 것(390·1280 넘침 0 · 콘솔 0 · 네트워크 0)은 다시 묻지 않는다. 남은 구멍만:

- **768px** — E2E 뷰포트 2종에 없는 유일한 폭이고 `_hoondok/worship.css` 의 유일한 미디어
  쿼리가 걸리는 지점이다. `_hoondok/family.css` 는 `@media` 가 0건이다
- **프로토타입 시각 대조** — §4.3 시퀀스로 375·768·1280 전부
- **상태 3종** — 빈 · 오류 · "준비 중" 제출이 `.empty` 3단 규격인지
- **막다른 골목 정직하게 만들기 (J7)** — 가정예배·가족은 `DEC-PWA-020`·`021` 대기라 열지 않는다.
  대신 "준비 중" 에서 멈추는 자리마다 **왜 멈췄는지 + 돌아갈 곳**을 둔다.
  `offline/page.tsx` 의 `.empty` 가 기준 구현이다. 설교 섭외 폼처럼 **입력을 다 채운 뒤 막히는
  자리는 입력을 지우지 않는다**(`REQ-PWA-013` "입력 보존")
- **대비·모션** — WCAG AA, `prefers-reduced-motion` 에서 장식 모션 정지
- `.col`(720px) 안쪽 그리드 — `.sm-list` 2열, `.sm-pastors` 줄바꿈, 챌린지 참여자 행,
  `.fm-scope` 토글 정렬

**소유 파일**
```
apps/web/src/app/(hoondok)/hoondok/worship/**
apps/web/src/app/(hoondok)/hoondok/family/**
apps/web/src/features/hoondok/{worship,family}/**
apps/web/src/app/_hoondok/{worship,family}.css
apps/web/src/test/hoondok-{worship,family}.test.tsx
```

**완료 기준**: `pnpm hoondok:check` · web Vitest · typecheck · lint · §4.3 대조 결과 문장 기록

---

### T2a — 권리 원장 API (T0 의존) · `REQ-PWA-011` P0 를 실제로 구현

- **`ENT-HD-005 content_rights`**
  `volume`(unique) · `work_title` · `source_keys` · `book_series` · `authority_grade` ·
  `status` varchar(`pending` 기본 / `allowed` / `withdrawn`) ·
  `scope_search` bool(검색 결과 스니펫) · `scope_full_text` bool(원문 전재) ·
  `scope_jeongseong` bool(정성 말씀) · `note` · 타임스탬프
  - "기능별 권리가 `allowed` 일 때만 동작" 이라는 요구사항 문장을 **서로 독립적인 세 개의 bool 로** 옮긴 것이다
- alembic `k5a6b7c8d9e0` 다음 리비전. **additive-only** (`PLAN-HD-001` §3):
  신규 테이블·nullable 컬럼·인덱스 추가만, **PG ENUM 금지**(varchar + 앱 검증)
- **`API-HD-013` `GET·POST·PUT /admin/hoondok/content-rights`**
  `main.py` 의 `_ADMIN_GATE` 로 등록 + 라우터 레벨 `verify_csrf` + `admin_service.log_audit`.
  **DELETE 없음** — `withdrawn` 이 철회 수단이다(편성 API 선례)
- **admin 화면** `apps/admin/src/app/(dashboard)/hoondok/rights/` + `features/hoondok/rights-*`
  (기존 편성 화면과 같은 `fetchAPI`·폼 패턴)
  - ⚠️ **함정**: `apps/admin/src/app/(dashboard)/layout.tsx:95` 의
    `NAV_ITEMS.find((i) => pathname.startsWith(i.href))` 는 **선언 순서대로 첫 매치**를 쓴다.
    `/hoondok/rights` 항목을 `/hoondok` **뒤에** 두면 권리 화면에서 "훈독 편성" 이 활성으로
    표시된다 → 앞에 두거나 최장 매치로 고친다
- **`hybrid_search()` 에 `volume_filter: list[str] | None = None` 선택 인자만 추가**
  (기본 `None` = 기존 동작 불변). Qdrant Prefetch 의 dense·sparse **양쪽에** 걸려야 한다.
  후처리 필터는 `top_k` 가 깎여 쓰지 않는다

**소유 파일**
```
apps/api/app/modules/hoondok/**
apps/api/app/modules/search/hybrid.py
apps/api/alembic/versions/**
apps/api/tests/**
apps/admin/src/app/(dashboard)/hoondok/rights/**
apps/admin/src/app/(dashboard)/layout.tsx   (NAV_ITEMS 1줄)
apps/admin/src/features/hoondok/rights-*
contracts/  (pnpm contracts:generate 산출물 — 직접 편집 금지)
```

**완료 기준**: pytest(201/409/404/422 · `admin_token` 없으면 401 · 게이트 계정 아니면 403 ·
경로 의존성에 `verify_csrf`·`require_admin_gate` 포함 단언) ·
`pnpm contracts:generate && pnpm contracts:check` 하위 호환(추가만) ·
`hybrid_search` 기존 호출자 회귀 0 · admin Vitest·build

---

### T2a 공개 API — 권리 원장과 같은 백엔드 트랙에서 먼저 구현

**API 3종**

- **`API-HD-014` `GET /hoondok/library`** — `status=allowed AND (scope_search OR scope_full_text)` 저작물 목록(공개). 정성 전용은 제외.
  0건이면 200 + 빈 목록
- **`API-HD-015` `GET /hoondok/search?q=&limit=`** — `scope_search` 허용 volume 만
  `volume_filter` 로 넘겨 `hybrid_search`. 결과는 **발췌 + 출처 + 권위 배지**.
  0건은 200 + 빈 배열(검색 실패와 구분). 검색 실패는 **503**(`search_failed_handler` 재사용).
  `REQ-PWA-015` — **검색어 원문을 서버에 저장하지 않는다**
- **`API-HD-016` `GET /hoondok/words/{volume}?page=&chunk_id=`** — `scope_full_text` 허용 시 페이지 읽기.
  미허용이면 **404**(존재 자체를 노출하지 않는다)
  - ⚠️ **함정**: `RawQdrantClient.scroll` 은 **커서 기반이고 `order_by` 가 없다.**
    point id 가 `uuid5(f"{volume}:{chunk_index}")` 라 스크롤 순서는 `chunk_index` 순이 **아니다**.
    → `volume` 필터(인덱스 있음) + `chunk_index` range 필터로 페이지를 자르고 앱에서 정렬한다.
    `scroll` 에 `order_by` 를 추가하는 안은 기존 호출자 파급이 커 택하지 않는다
  - 페이지 크기는 **20청크**다. `chunk_id`가 있으면 해당 청크가 있는 구간으로 이동한다.
    다른 volume의 ID·삭제된 청크·권리 미허용은 404다.
  - 모든 신규 응답은 현재 권리를 재확인한다. 빈 허용 목록은 검색 호출 없이 빈 결과로 종료한다.

### T2b — 말씀 3화면 실데이터화 (T2a 의존) · 닫는 여정 **J4·J5**

**web**

- `features/hoondok/library/` 의 fixture 소비를 API 로 교체
- `screens.ts` 의 `/hoondok/words` **하드코딩 제목 `"천성경 1편 3장"` 을 동적 제목으로** 전환
- `TAB_STAGE.library` 를 `preview → live`. 앱 셸 검색 버튼도 프리뷰 조건에서 해제한다. 프리뷰 `.notice` 배너 제거
- ⚠️ **빈 서고 대응 (P0)**: `library-screen.tsx` 는 fixture 가 비지 않는다고 가정해 `.empty` 상태가
  **없다**. 권리 원장 기본값이 전부 `pending` 이라 등록 전에는 저작물 0건이다.
  `.empty` 규격으로 "아직 열린 말씀이 없어요" 를 넣되 **`empty__cta` 로 `/hoondok` 으로 보낸다** —
  빈 서고에서 돌아갈 길이 없으면 탭을 켠 것이 오히려 후퇴다
- **"이어 읽기" 섹션**: 실데이터에 읽기 기록 소스가 없다. `/hoondok/words` 마지막 열람을
  localStorage(`hoondok:read:last`, 기기 전용 — 오늘의 한 줄 선례)에 남겨 채우고,
  기록이 없으면 섹션을 렌더하지 않는다. **서버 저장 안 함**(`REQ-PWA-015`)
- **재사용**: `wordId` 가 없으면 링크가 아닌 `.shelf__item` 패턴이 이미 있다 →
  `scope_full_text=false` 저작물(검색엔 나오지만 원문은 못 여는 것)에 그대로 매핑
- **원문 뷰 "읽음" 버튼**: `POST /hoondok/missions/study/complete` 호출(백엔드 이미 있음).
  비로그인이면 `read` 와 같은 패턴으로 localStorage → 로그인 후 소급(`use-missions.ts` 재사용)
- **형광펜·노트·북마크는 계속 "표시만"** (`PLAN-HD-002` §1.3 비범위 유지). 다만 눌러도 아무 일이
  없는 지금 상태는 두지 않고 **비활성 + 사유 문구**로 바꾼다
- 프로토타입의 "1장 / 2장" 목차는 코퍼스 payload 에 장·절 메타가 없어 만들지 않는다.
  목차 레일은 **이 권의 구간 목록**으로 대체하고, 없는 메타는 "확인되지 않음" 으로 적는다

**여정 연결**

- **J4 — AI 질문 → 원문**: `ask-detail.tsx` 의 근거 말씀 카드에 "원문 보기" 링크를 단다.
  `source.volume` 이 `scope_full_text=true` 일 때만 링크이고 아니면 지금처럼 본문만 보인다
  (없는 길을 만들지 않는다). `chunk_id` 쿼리로 해당 원문 구간을 연다
- **J5 — 검색 0건 문구**: `"지금은 예시 말씀 한 편에서만 찾을 수 있어요"` 는 프리뷰 전제라
  실데이터에서 거짓이 된다. `AC-005-*` 의 "0건 시 제안(가짜 결과 없음)" 대로 다시 쓰고,
  이미 있는 `ask-hint`(→ `/hoondok/ask`)를 0건 상태에서도 보이게 둔다

⚠️ **E2E 분리 (P0)**: `tests/e2e/hoondok-preview.spec.ts` 는 8라우트 전부에 대해
"백엔드 요청 0" 과 `.notice` 문구를 단언한다. 말씀 3화면이 실데이터가 되면 **둘 다 깨진다.**
→ 말씀 3라우트를 새 `tests/e2e/hoondok-library.spec.ts`(실데이터 · 로딩·0건·오류 상태)로 옮기고
`hoondok-preview.spec.ts` 의 `PREVIEW_PATHS` 는 프리뷰 5라우트만 남긴다.
`playwright.config.ts` 의 `hoondok-chromium` `testMatch` 에 새 spec 을 등록한다.
`/hoondok/words/cheonseonggyeong-1-3` 고정 슬러그가 사라지므로 새 spec 은 권리 원장에 등록된
volume 을 시드로 넣고 그 id 를 쓴다.

**소유 파일**
```
apps/web/src/app/(hoondok)/hoondok/{library,search,words}/**
apps/web/src/features/hoondok/library/**
apps/web/src/features/hoondok/{screens,tabs}.ts            ← 이 트랙 단독
apps/web/src/features/hoondok/use-missions.ts (study kind) ← 이 트랙 단독, T7 은 소비만
apps/web/src/features/hoondok/ask/components/ask-detail.tsx (J4 링크 1곳)
apps/web/src/app/_hoondok/{library,ask}.css
apps/web/src/test/hoondok-{library,ask}.test.tsx
```

**완료 기준**: pytest(0건 200·503·404·권리 미허용) · `contracts:check` 하위 호환 ·
web Vitest(빈 서고·0건·로딩·오류·플래그) · `pnpm hoondok:check` · `make e2e` ·
§4.3 대조(3화면 × 3폭)

---

### T3a — 정성 맞춤 말씀 API (T2a 의존) · `AC-023-01`

- **`ENT-HD-006 jeongseong_readings`**
  `period_id` FK · `reading_date` · `volume` +
  **`DailyReading` 의 AC-016-01 메타와 같은 필드**(`title`·`body`·`speaker`·`spoken_on`·
  `work_title`·`edition`·`authority_grade`·`review_status`·`chunk_id`·`estimated_minutes`).
  `(period_id, reading_date)` unique
  - **이 모양을 맞추는 이유**: 응답을 `DailyReadingPublic` 과 같은 스키마로 내면 web 이
    `MalssumCard`·`AuthorityBadge`·출처 줄을 **그대로 재사용**한다. T3b 가 새 카드 컴포넌트를
    만들지 않아도 된다
  - 코퍼스가 주지 않는 칸(`speaker`·`edition`)은 `candidates.py` 의 `suggested_speaker` 규칙을
    쓰고, 그래도 없으면 **"확인되지 않음"** 으로 둔다
- **`API-HD-017` `GET /hoondok/me/jeongseong/today`** — 오늘 분이 있으면 그대로, 없으면
  **그 자리에서 1일분만** 뽑아 저장하고 돌려준다(확정 결정 5).
  뽑기는 `candidates.py` 추출 규칙 + `hybrid_search` 재사용이며 **생성 LLM 을 부르지 않는다.**
  검색어는 정성 `topic`(`JeongseongPeriod.topic`, max 40자)
- **권리**: 독립적인 `scope_jeongseong` 허용 volume 안에서만 고르고 저장된 말씀도 조회 시 재검증한다 — `AC-023-01` "권리 허용 정본 안에서"
- **중복 방지**: 같은 기간 안에서 이미 쓴 `chunk_id` 는 제외
- **후보 0건**이면 저장하지 않고 `status="none"` → 화면은 전체 편성으로 폴백
- **확정:** 기존 7·21·40일 달력 기준 종료일과 `read` 완료 진도를 유지한다. 결석으로 기간을 연장하지 않는다.
- `(period_id, reading_date)` 고유 제약으로 하루 한 건을 보장한다. 완료 후 재조회도 같은 말씀이다.
  미래 시작일에는 생성하지 않으며 계정 삭제 시 함께 삭제한다.

**소유 파일**: T2a 와 같은 backend 영역 — **T2a 머지 후 스택**(같은 alembic 체인·같은 라우터)

**완료 기준**: pytest(lazy 생성 1회만·중복 chunk 제외·0건 `none`·권리 밖 volume 미선택·
`admin_token` 만 가진 요청 401) · `contracts:check` · additive-only 리허설

---

### T3b — 정성 말씀 읽기 화면 (T3a 의존) · 닫는 여정 **J6**

- `/hoondok/read`: 정성 진행 중이면 정성 말씀을 읽는다. 완료 기록은 기존 `read` 미션 그대로
- 정성 없음 / 후보 0건 / 오류 **세 상태**. 후보 0건이면 전체 편성으로 폴백하되
  **정성이 오늘 쉬는 이유를 한 줄로 말한다** — 말없이 다른 말씀을 보이면 사용자가 앱을 의심한다
- 진도는 기존 달력 기준이며 일반 편성으로 폴백한 날도 기존 `read` 완료로 인정한다.
  사용자 ID·KST 날짜를 쿼리 키에 넣어 로그아웃·자정 이후 이전 말씀을 표시하지 않는다.
- ⚠️ **함정 (P1)**: `read/page.tsx` 는 **서버 컴포넌트**이고 `loadToday()` 는 쿠키를 보내지 않는
  공개 호출이다(`features/hoondok/api.ts` 주석 참조). 정성 말씀은 `hoondok_token` 이 필요하다.
  → **RSC 에서 쿠키를 포워딩하지 않는다.** 서버 렌더는 공개 오늘 말씀 그대로 두고, 로그인 +
  정성 active 일 때만 **클라이언트 컴포넌트가 카드를 교체**한다(`use-jeongseong.ts` 와 같은
  React Query 패턴). 비로그인 SSR·SEO·오프라인 폴백이 지금 그대로 유지된다.
  교체 순간의 깜빡임은 스켈레톤으로 덮는다

**소유 파일**
```
apps/web/src/app/(hoondok)/hoondok/read/**
apps/web/src/features/hoondok/jeongseong/**
apps/web/src/features/hoondok/{jeongseong-api,use-jeongseong}.ts  ← 단독, T7 은 소비만
apps/web/src/app/_hoondok/sheet.css
apps/web/src/test/hoondok-jeongseong.test.tsx
```
**`home-missions.tsx` 는 만지지 않는다** (T7 단독 소유).

---

### T4 — 클라이언트 오류 수집 (T3a 의존) · `PLAN-HD-001` §6 sub-PR H 그대로

- **`client_error_events`** — `id`·`occurred_at`·`kind` 고정 오류 코드 Literal(`sw_register`·`install_prompt`·
  `unhandled`·`api_5xx`)·고정 안전 문구·정규화된 `path`·`user_id` nullable
- **`API-HD-018 POST /hoondok/client-errors`** — 익명 허용, 기존 rate limiter 재사용
- **web 전역 핸들러** — `window.onerror`·`unhandledrejection`·SW 등록 실패.
  **hoondok 스코프에서만** 등록
- **연결 지점**: `features/hoondok/service-worker.tsx` 의
  `console.warn("[hoondok] 서비스워커 등록 실패", error)` 에 달린 주석이 이미
  *"등록 실패 보고는 Phase 3 H 몫이다"* 라고 못박고 있다 — **그 한 줄을 보고 호출로 바꾼다**
- **패턴**: `HoondokServiceWorker` 와 같은 `"use client"` + `useEffect` 컴포넌트를 hoondok layout 에
  둔다. 라우트 그룹 밖(`/login` 등)으로 이동하면 그룹 layout 이 언마운트되며 `useEffect` cleanup 이
  리스너를 뗀다 — **Vitest 로 이 해제까지 단언한다**
- `REQ-PWA-015` — **질문·메모·검색어 원문 수집 금지**
- 처리된 API 5xx와 설치 실패도 수집한다. 보고 요청 실패는 재보고하지 않는다.
- 원본 오류 메시지·검색어·질문·토큰·쿼리 문자열을 저장하지 않는다. 200자 절단만으로 보호했다고 판단하지 않는다.
- 계정 삭제 시 사용자 연결 오류 기록을 삭제한다. 조회는 psql 로만. **admin 화면 없음**

**소유 파일**
```
apps/api/app/modules/hoondok/client_errors*    (신규)
apps/web/src/features/hoondok/observability/**
apps/web/src/features/hoondok/service-worker.tsx (console.warn 1줄)
apps/web/src/test/hoondok-observability.test.ts
```
backend 는 alembic 체인이 겹치므로 **T3a 뒤로 스택**한다.

---

### T5 — 미결 UI 결정 반영 (독립, 즉시)

5건 중 2건을 여기서 고치고, 1건은 T7 로 넘기고, 2건은 근거와 함께 현행 유지·보류로 닫는다.

| 항목 | 반영 | 근거 |
|---|---|---|
| 질문 상세 '화자' 칸 | `features/hoondok/ask/format.ts` 의 `sourceFields()` 첫 칸에 `{ id: "speaker", text: "화자 확인되지 않음", isUnknown: true }` 추가 | `REQ-PWA-012` 는 미확인 항목을 **생략이 아니라 "확인되지 않음"** 으로 적게 한다. 구현자의 "`volume` 이 화자를 포함" 가정은 `말씀선집 355권` 예시로 반증됐다 |
| 오버스크롤 배경 | **안 2** — `html:has([data-app="hoondok"]) { overscroll-behavior-y: none }` | 안 1(토큰 선택자 확장)은 `tests/e2e/hoondok.spec.ts:57` 의 토큰 경계 계약을 깬다. 계약을 우회하지 않는다. `hoondok-css.mjs` 는 `:root` 와 hex 만 보므로 이 규칙은 통과한다(실측). 대가는 Android Chrome 의 당겨서 새로고침이 사라지는 것이다 |
| 설치 카드 노출 조건 | **현행 유지** (`source === "user"`) | 소급 경로에서 카드를 띄우면 "완료했으니 설치하자" 맥락이 아니라 가입 직후 팝업이 된다 |
| 세리프 말씀 인용 | **보류.** TODO Questions 유지 | `DEC-PWA-017` 기각 근거였던 "장년층 가독성 확인" 이 아직 수행되지 않았다. 확인 없이 뒤집지 않는다 |
| 홈 '이번 주' 메타 | → **T7 로 이관** | 같은 파일을 여러 트랙이 건드리는 것을 피한다 |

**소유 파일**: `apps/web/src/features/hoondok/ask/format.ts` · `apps/web/src/app/hoondok.css` ·
각 Vitest. **`home-missions.tsx` 는 만지지 않는다.**

---

### T7 — 홈 흐름 통합 (T2b · T3b 의존) · 닫는 여정 **J2·J3·J6** · 이 계획의 결론

홈은 매일 열리는 유일한 화면이라 네 갈래 변경이 전부 여기로 모인다. **한 트랙이 한 번에** 고쳐서
같은 파일을 네 번 건드리는 충돌을 없앤다. **새 훅을 만들지 않는다** — T2b 의 `use-missions.ts`
(study)와 T3b 의 `use-jeongseong.ts`(today)를 **소비만** 한다.

| # | 변경 | 근거 |
|---|---|---|
| 1 | **3번째 미션 카드 점등** — `isDisabled` 제거, `href="/hoondok/library"`, 완료는 `POST /hoondok/missions/study/complete` | `MISSION_KINDS` 에 `study` 가 이미 있다(`models.py:19`). **백엔드 변경 0.** 카드 문구가 가리키던 "다음 단계" 가 T2b 다 |
| 2 | **정성 카드** — active 기간이면 오늘 말씀 자리를 정성 말씀으로 바꾸고 `n/N일`·D-day 표시 | J6. `/read` 와 같은 데이터를 쓰되 홈은 요약만 |
| 3 | **편성 없는 날의 탈출구** — `malssum-card.tsx:42` 의 `"서고·검색은 준비 중이에요. 내일 아침에 다시 열어 주세요."` 를 서고 CTA 로 교체 | J3. 서고가 열린 뒤에는 **이 문장이 거짓말**이다. 고치지 않으면 T2b 가 만든 길을 홈이 가린다 |
| 4 | **'이번 주' 메타** — `summary?.streak_days` 가 정의된 뒤에만 `.sect__meta` 렌더 | T5 에서 이관. 로딩 중 거짓 `0` 이 두 번 보이는 문제 해소 |
| 5 | `"오늘의 실천 3가지 · 약 5분"` 메타 재계산 | 동작하는 미션이 1개 → 2개가 되므로 숫자가 바뀐다 |

- **`pray`(기도하기)는 손대지 않는다.** 화면이 없고 범위 밖이다. 3장 중 1장이 회색인 상태는
  유지하고, 비활성 사유 문구도 그대로 둔다 — **없는 기능을 곧 나온다고 말하지 않는다**
- **`study` 완료 판정**: 원문을 **열었다**가 아니라 **읽었다**여야 한다.
  **확정:** 원문 뷰 하단의 "읽음" 버튼(명시적 행동)으로 한다 — 스크롤 깊이·체류 시간 같은
  암묵 판정은 `REQ-PWA-015`(측정 최소화)와 어긋나고 오탐이 많다
- **연속일 기준은 바꾸지 않는다** — `read` 완료 기준이라는 2026-09-16 결정 그대로.
  `study` 는 연속일에 세지 않는다

**소유 파일**
```
apps/web/src/features/hoondok/components/home-missions.tsx
apps/web/src/components/hoondok/malssum-card.tsx
apps/web/src/test/hoondok-missions.test.tsx
apps/web/src/test/hoondok.test.tsx
```

---

### T6 — 문서·계약 정합 (마지막)

이 문서 §9 진행표·결정 기록 · `docs/specs/api/hoondok-api.md`(API-HD-013~018) ·
`docs/specs/domain/hoondok-entities.md`(ENT-HD-005·006·007) ·
`docs/specs/web/hoondok-design-system.md` 결정 표 · `docs/TODO.md` ·
`docs/README.md` 색인 · `apps/web/AGENTS.md` 라우트 목록

- **닫는 Questions**: 화자 칸 · 이번 주 메타 · 오버스크롤 3안 · 설치 카드 조건 (4건)
- **유지**: 세리프 인용 · `DEC-PWA-001` 약관 · `DEC-PWA-020`·`021` · 가족 공개 범위 문구 · 메일 제공자
- **새로 여는 Questions**: ① `DEC-PWA-002` 권리 범위 — 권리 원장은 **틀만** 만들었고 어떤
  저작물을 `allowed` 로 올릴지는 운영 결정이다 ② `pray` 미션의 화면.
  `study` 읽음 버튼과 달력 기준 정성은 확정되어 질문으로 다시 열지 않는다
- `PLAN-HD-002` §1.3 의 "007~009 실데이터 전제 = 권리 원장·Qdrant 백필" 중 **권리 원장 쪽은 이
  계획이 해소**하고 백필은 계속 비범위임을 그 문서에 한 줄로 정정한다

---

## 6. 파일 소유 — 절대 규칙

```
즉시 병렬 :  T0(조사)  T1(worship·family)  T5(ask/format.ts, hoondok.css)
그 다음   :  T2a(backend + admin rights)                      ←T0
그 다음   :  T2b(library·search·words·ask-detail·e2e 분리)     ←T2a
             T3a(backend, alembic 스택)                        ←T2a
그 다음   :  T3b(read 정성 교체)                               ←T3a
그 다음   :  T4(backend 스택 + web observability)              ←T7
마지막    :  T7(홈 통합)                                       ←T2b·T3b
             T6(docs)
```

**한 파일 = 한 트랙.** 가장 위험한 충돌 지점은 홈이라 전부 T7 로 모았다.

| 파일 | 단독 소유 |
|---|---|
| `features/hoondok/{screens,tabs}.ts` | T2b |
| `features/hoondok/use-missions.ts` (`study` kind) | T2b — T7 은 소비만 |
| `features/hoondok/ask/components/ask-detail.tsx` | T2b (J4 링크) |
| `features/hoondok/ask/format.ts` | T5 (화자 칸) — 위와 **다른 파일** |
| `features/hoondok/{jeongseong-api,use-jeongseong}.ts` | T3b — T7 은 소비만 |
| `app/(hoondok)/hoondok/read/**` | T3b |
| `features/hoondok/components/home-missions.tsx` · `components/hoondok/malssum-card.tsx` | **T7 단독** |
| `app/hoondok.css` (토큰) | T5 |
| `tests/e2e/**` · E2E harness/seed · Makefile·CI E2E | 검증 담당 (웹/API 소유자와 계약 조율) |
| `docs/**` · `apps/web/AGENTS.md` | 문서·검증 담당 |
| alembic · `contracts/` 생성물 | backend 트랙 **순차** (T2a → T3a → T4). 동시 편집 금지 (alembic multi-head 회피) |

`contracts/openapi.json` 과 생성 SDK 는 **직접 편집하지 않는다.**
FastAPI 모델 → `pnpm contracts:generate` 경로만 쓴다.

---

## 7. 오케스트레이션 규약

1. **태스크 1건 = 격리 worktree 서브에이전트 1개.** 브리프는 **자립형**이어야 한다 —
   이 문서의 해당 절 + §3.2 제약 5줄 + §6 파일 소유 + 완료 기준 명령을 그대로 싣는다.
   에이전트는 자기 worktree 안에서만 작업하고 **push 하지 않는다.**
2. 에이전트는 **커밋하지 않고** 변경 파일·미커밋 diff·검증 결과를 보고한다.
   오케스트레이터가 diff를 리뷰해 통합 브랜치에 반영하고 통합 트리에서 검증한다.
   구체적인 결과를 제시한 뒤 커밋 승인을 받는다. 푸시·PR 생성·배포는 자동 진행하지 않는다.
3. **진행표를 트랙이 끝날 때마다 먼저 갱신한다.** 컨텍스트 압축 후의 복원 지점이다.
4. 서브에이전트 결과는 **요약만** 받는다. 파일 덤프를 오케스트레이터로 끌어오지 않는다.
5. 각 UI 브리프에 **닫는 여정 번호(J2~J7)를 명시**한다(§3.3).
6. 끝난 worktree 는 `make worktree-gc` 로 정리한다.

---

## 8. 검증 게이트

### 8.1 명령

```bash
pnpm hoondok:check                                # :root 0 · 토큰 밖 hex 0 · 브레이크포인트
node tooling/checks/docs-links.mjs                # 문서 링크, 새 오류 0
pnpm contracts:generate && pnpm contracts:check   # 계약 드리프트 0 · 하위 호환(추가만)
make ci                                           # pytest · tooling · docs · boundaries · web/admin test·lint·build·typecheck
make e2e                                          # 격리 compose + 시드 + Playwright
```

### 8.2 추가 게이트

1. **additive-only 리허설** (`PLAN-HD-001` §3-4) — 새 alembic head 가 적용된 DB 위에서
   **직전 main 백엔드 이미지가 기동**하는지 1회 확인하고 결과를 §9 에 적는다.
   이미지 기본 진입점 실패와 앱 직접 기동 호환성 결과를 분리해 기록한다.
2. **라이브 브라우저 대조** — §4.3 시퀀스로 T1 의 5화면 + T2b 의 3화면을 375·768·1280 에서
   프로토타입과 대조. 상태 3종과 `prefers-reduced-motion` 을 실측.
3. **여정 워크스루** — 화면 단위 검증으로 대체할 수 없다. 라이브 스택에서 한 번에 통과시킨다.
   막히는 곳이 나오면 **그 자리가 결함**이다.

   | 여정 | 통과 조건 |
   |---|---|
   | J2 아침 루틴 | 홈에서 **동작하는 미션이 2장**이고 각 카드가 갈 곳이 있다 |
   | J3 편성 없는 날 | 편성을 지운 상태에서 홈이 **서고로 보내는 CTA** 를 준다 (막다른 골목 0) |
   | J4 질문 → 원문 | 질문 → 답 → 근거 카드 → "원문 보기" → 그 권의 원문이 열린다 |
   | J5 말씀 찾기 | 탭 "말씀" → 서고 → 검색 → 결과 → 원문 → **`study` 미션 완료** → 홈 반영 |
   | J5' 빈 서고 | 권리 원장이 **빈 상태**에서 탭을 눌러도 갈 곳이 있다 |
   | J6 정성 | 정성 생성 → 다음 날 홈·`/read` 가 **주제에 맞는 다른 말씀** → 완료 → `n/N일` |
   | J7 가정예배 | 제출이 막히는 자리마다 **이유 + 돌아갈 곳**, 입력 보존 |

4. **codex 독립 리뷰 2회** — 트랙 전부 머지 직후 1회, PR 직전 1회. 라운드 상한 3.

   ```bash
   codex exec -s read-only "<브리프>"
   ```

   **1회차 브리프에 위 여정 표를 반드시 넣는다** — 파일 단위 리뷰만으로는 J3 같은
   "문구가 거짓말이 되는" 결함이 잡히지 않는다(`malssum-card.tsx:42` 가 그 예다).
   **중단 규칙**: "이전 라운드에서 닫은 지적 수 − 새로 열린 지적 수 ≤ 0" 이면 발산으로 보고
   codex 호출을 멈춘다. 대체 검증은 `make ci`·`make e2e` + 독립 에이전트로 한다.

5. **기준선 비교** — §2.2 의 수치는 **참고값**이다. 실행 결과만 적고 기준선으로 복사하지 않는다.

---

## 9. 진행표 · 결정 기록 · 완료 증거

### 9.1 진행표 (트랙이 끝날 때마다 **먼저** 갱신)

| 트랙 | 범위 | 닫는 여정 | 상태 |
|---|---|---|---|
| T0 | volume 메타데이터 조사 → 권리 원장 키 확정 | — | ✅ 완료 |
| 준비 | 계획 보완 · 격리 E2E 성공 경로 시드 · 도구 준비 | — | ✅ 환경·seed·실제 API smoke 완료 |
| T1 | 프리뷰 5화면 768px·프로토타입 대조·상태 3종·막다른 골목 정직화 | J7 | ✅ 구현·자체/MCP·통합 검증 완료 |
| T2a | 권리 원장 + admin·공개 API 3종 + `volume_filter` | (선행) | ✅ 구현·단위/실제 PG·통합 검증 완료 |
| T2b | 말씀 3화면 실데이터 · ask→원문 링크 · `TAB_STAGE.library` live · E2E 분리 | J4·J5 | ✅ 구현·MCP·실데이터 E2E 완료 |
| T3a | `jeongseong_readings` + `GET /hoondok/me/jeongseong/today` (lazy) | (선행) | ✅ 구현·단위/실제 PG·통합 검증 완료 |
| T3b | `/read` 정성 말씀 교체 (클라이언트 컴포넌트) | J6 | ✅ 구현·자체/MCP·통합 검증 완료 |
| T4 | `client_error_events` + `POST /hoondok/client-errors` + 전역 핸들러 | — | ✅ PG 경합·MCP 수집·로그/trace 독립 검증 완료 |
| T5 | 화자 칸 · 오버스크롤 (미결 결정) | — | ✅ 구현·자체/MCP·통합 검증 완료 |
| T7 | 홈 통합 — 미션3 점등 · 정성 카드 · 빈 상태 CTA · 이번주 메타 | J2·J3·J6 | ✅ 홈 여정·메타 MCP·통합 검증 완료 |
| T6 | 문서·계약 정합 | — | ✅ 명세·색인·결정·최종 증거 반영 완료 |
| 게이트 | `make ci` · `make e2e` · additive-only 리허설 · 여정 워크스루 · codex ×2 | — | CI·E2E 90·MCP PASS · 리뷰 3회 발견 전건 보완 검증 · 구 앱 호환 PASS / 기본 CMD 롤백 FAIL(배포 전 과제) |

### 9.2 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-21 | 감사 범위 = 프리뷰 라우트 집중. 실데이터 9는 `PLAN-HD-004` 감사분을 신뢰 | 확정 · 인터뷰 |
| 2026-09-21 | 권리 게이트 = 저작물 단위 `content_rights` allow-list 신설, 기본 전부 `pending` | 확정 · 인터뷰 |
| 2026-09-21 | 정성 맞춤 말씀 = 매일 조회 시점 lazy 생성 후 저장 | 확정 · 인터뷰 |
| 2026-09-21 | 말씀 3화면은 프리뷰 플래그 밖으로 꺼내 정식 노출. 가정예배 4 + 가족 1 은 프리뷰 유지 | 확정 · 인터뷰 |
| 2026-09-21 | 미결 UI 5건 = 추천안 일괄 반영(화자 칸 추가 · 이번주 메타 조건 렌더 · 오버스크롤 안 2 · 설치 카드 현행 · 세리프 보류) | 확정 · 인터뷰 |
| 2026-09-21 | `study` 미션은 원문 뷰 "읽음" 버튼으로 받는다. 연속일 기준은 `read` 그대로 | 확정 · 사용자 결정 |

### 9.3 완료 증거

- T0: 승인된 운영 메타데이터 읽기 전용 조사 완료. 417,579청크·664개 volume, 평균 628.88·최대 4,283청크.
  청크 번호 0 기반 연속, 중복·누락·형식 오류 및 book_series 충돌 없음. volume unique 키·20청크 페이지 확정.
  본문·벡터 복사 및 운영 변경 없음. 본 세션에서 운영 재조회하지 않는다.
- 사전 점검: MCP 로컬 프로토타입 접속·resize·media·screenshot, CLI Chromium 및 Codex read-only 호출 확인.
  기존 E2E 85건 **목록 확인**이며 새 전체 테스트 통과 증거가 아니다.
- 준비: pnpm frozen·uv frozen 설치, Qdrant·oasdiff 이미지 준비, 기준 HEAD git archive로 구 백엔드 이미지 빌드 완료.
- 문서 링크 검사: 문서 191개·링크 332개, 새 오류 0. E2E 목록 88건 확인(실행 전).
- 자동 E2E에 동일 날짜 정성 유지·전날 이력 이후 다른 후보·홈/read 일치·UI 완료 후 2/7일 및 read 연속 2일 시나리오를 추가했다. 실행 결과는 아래 통합 증거에 기록했다.
- MCP 계획 범위: J4 답→근거→원문, J3 편성 없음 서고 CTA, J5′ 빈 서고, 오류·로딩, 8화면×3폭 정본 대조. 실제 완료 증거는 아래에 구분했다.
- additive-only 기본 CMD: **실패**. `git archive 7abc4ef apps/api .dockerignore`로 만든 기준 이미지
  `truewords-hoondok-baseline:7abc4ef`의 기본 진입점은 새 DB revision `l6b7c8d9e0f1`을 몰라 exit 255다.
  `docker run --rm --network tw-monorepo-e2e_default`에 격리 DB 환경변수를 주고 해당 이미지를 실행하면
  `Can't locate revision identified by l6b7c8d9e0f1`을 재현한다. 구 앱 직접 기동 결과와 분리한다.
  운영 배포 전 기본 CMD 롤백 시작 경로를 보완·재검증해야 한다. 이번 변경에서 배포 절차는 수정하지 않는다.
  **2026-09-22 해소**: 코드 변경 없이 되돌리기를 2단계(새 이미지 `alembic downgrade` → `rollback-backend`)로 확정하고
  같은 격리 환경에서 재리허설했다 — 실패 재현 → downgrade → 구 이미지 **기본 CMD** 기동 `/health` 200·`/hoondok/today` 200.
  기준 이미지 digest 는 위와 동일하게 재현됐다. 절차는 [rollout runbook §되돌리기 층 0](../../runbooks/hoondok-pwa-rollout.md).
- 구 앱 직접 기동 스키마 호환: **PASS**. 같은 이미지에 `uvicorn app.main:app --host 0.0.0.0 --port 8000`을
  명시해 새 DB에서 startup 완료, `/health` 200·`status=ok`, `/hoondok/today` 200·`available`·편성 본문 존재 확인.
  기준 이미지 digest `sha256:3d16e9fb2b4656f7b50ba932caac9bad3c5f5e4dcd22537aec28f90b3c837988`.
  테스트 컨테이너 종료·제거. 기본 CMD의 실패를 이 결과로 덮지 않는다.
- 격리 인프라 smoke: 새 migration·전체 계정/챗봇/오늘편성/합성 코퍼스 seed 성공. 실제 HTTP library3권·search28청크·words25청크·정성 available 확인.
- 백엔드 담당 자체 검증: pytest 1096 passed / 4 skipped / 1 xfailed, 신규 대상 34 passed;
  정성 충돌 winner 재조회·검색 중 기간 중단·독립 정성 권리·계정 삭제 실제 행 제거 포함.
  admin 119 tests 및 build 통과. 통합 make ci/e2e 결과는 아래에 별도로 기록한다.
- 첫 통합 `make ci`: PASS. pytest 1096 passed / 4 skipped / 1 xfailed, web 232·admin 119·SDK 13,
  계약 drift/호환·도구/문서·lint·build·typecheck 완료.
- 첫 `make e2e`: 84 passed / 4 failed, 2.3분. 3건은 원문 화면 404(API 직접·프록시 호출은 200),
  1건은 미확인 badge locator 중복이다. 원문 원인 수정·badge exact 매칭 후 재검증한다.
  정성 날짜 이력 전환·다른 말씀·UI 완료·2/7일·연속 2일 및 공개 API 권리·20청크 구간은 통과.
- 실제 PostgreSQL 경합·삭제(백엔드 담당): 고유 계정으로 동시 GET 4개 모두 200·available·동일 reading,
  SQL 저장 1행. 오류·read 완료 생성 후 계정 DELETE 204, 기간·말씀·미션·오류 0행 및 익명화·me 401 확인.
  기존 seed·권리 데이터 변경 없음.
- 독립 리뷰 1차: **FAIL, P1 1건·P2 4건**. 읽기 전용 Codex 결과는 로컬 `/tmp/hoondok-review-1-output.txt`.
  계정 삭제 후 오류 재삽입(P1), 자식 삭제와 정성 생성 경합(P2), 검색 전용 원문 링크(P2),
  자정 양일 같은 후보 저장(P2), 빈 서고/미편성 CTA 순환(P2)을 발견했다. 수정 후 개별 회귀와 2차 리뷰로 닫는다.
- 원문 E2E 404 추가 조사: 브라우저 요청이 `%25EB...`로 이중 인코딩됨을 확인했다.
  Next params의 encoded volume을 decode 한 번 한 뒤 API에서 encode 하도록 웹 담당이 수정했다. MCP에서 정상 원문·인용 이동을 확인했고 최종 E2E의 폭별 3건도 통과했다.
- 독립 리뷰 2차: 이전 5건 모두 closed, 신규 P1 1건으로 **FAIL**. 백엔드 연결 실패 시 Next rewrite가
  검색어를 포함한 proxy URL을 서버 로그에 남긴다. 검색 전용 안전 BFF와 실제 장애 로그 회귀로 보완 중.
  결과 `/tmp/hoondok-review-2-output.txt`; 닫힘 5−신규 1=4로 마지막 3차 리뷰를 진행한다.
- MCP J3: 실제 오늘 편성 날짜를 임시 이동해 API `status=none` 확인, 홈의 서고 CTA 확인 후 원복.
  J4: 실제 SSE 질문→답→근거 원문 링크→001권의 chunk_id 구간 통과. J5: 홈→서고→검색→355권→읽음→홈 study 완료,
  pray 비활성 유지. J5′: 권리를 임시 pending으로 바꿔 빈 서고→홈 귀환 확인 후 원복.
- MCP 상태: 실제 scope_search를 임시 해제한 검색 0건은 제안·AI 질문·서고 귀환 제공;
  검색 전용 원문은 실제 404와 서고 귀환 제공. 서고 응답 지연→로딩·503→오류/재시도는 브라우저 route 주입으로 검증.
  원문 404·빈 서고·검색 0건은 실제 API 응답이며 지연·503 주입과 구분한다.
- MCP 오류 수집: 처리된 API 503과 합성 unhandled 이벤트가 각각 `{kind,path}`만 전송.
  URL 쿼리·오류 원문의 private 문자열 0, 보고 endpoint를 503으로 해도 재귀 보고 0.
  설치/SW 실패·리스너 cleanup은 Vitest 근거이며 MCP에서 실기기 설치를 대신했다고 기록하지 않는다.
- MCP J7: 섭외 제출 후 주제·메모 보존, 미전송 사유와 설교 목록 복귀 확인. 프리뷰 5화면 실제 API 요청 0.
- MCP 시각: 8화면×375·768·1280 가로 넘침 0, `.playwright-mcp/hd005-*.png`와 정본 대응 PNG(커밋 제외).
  정본 활성 data-screen의 보이는 요소만 비교했다. 말씀 3화면의 col/shelf/shelf-item/input/scripture/lede는
  글자 크기·행높이·여백·반경·색·폭 차이 0. 프리뷰의 공통 규격도 일치하고 preview 안내·비활성 동작은 의도된 차이다.
  0px border none/solid는 reset 차이로 시각 영향 없음. 정본 rq 전용 CSS가 없어 섭외의 행 보정은 기존 구현 유지;
  카드 부모 여백만 바꾸려던 변경은 철회했다. 전체 8화면 reduced-motion의 장식 애니메이션 0, 검색 Tab→찾기 포커스 정상.
  앱 예상 auth/me 401, 권리 404, 주입 503과 정본 favicon 404를 JS 결함으로 합산하지 않았다.
- 플래그 실HTTP(web 담당, 독립 3007): 17라우트×3조합 **51/51 통과**. 둘 OFF=17개404,
  훈독 ON/프리뷰 OFF=실데이터12개200·프리뷰5개404, 둘 ON=17개200. 전부 noindex/nofollow.
  전체 증거 `/tmp/tw-journey-flag-matrix.json`; 별도 서버 종료 완료.
- PG 경합 최종 검증: pg_blocking_pids로 실제 잠금 대기를 확인하는 3개 회귀를 포함해
  백엔드 전체 1099 passed / 4 skipped / 1 xfailed (42.07초). 세 테스트는 별도 격리 DB URL opt-in이다.
- 검색 로그 P1 보완: 전용 Next BFF, 고정 `SEARCH_FAILED` 503·no-store, 검색 경로만 개발 요청 로그 제외.
  web 담당 standalone production·dev 각각 upstream 미기동에서 검색 sentinel→503, UI sentinel→200,
  stdout/stderr 민감 문자열 0. dev의 비검색 `/hoondok/read` 로그 유지. 7개 회귀 포함 web 244 tests·build·typecheck 통과.
  증거 `/tmp/tw-search-private-evidence.json`, `/tmp/tw-search-private-{production,development}.log`.
- 승인 항목 대조에서 빠졌던 4건을 구현하고 MCP 재검증: 실제 저작물명 앱바, 전체 원문 구간 목록,
  2구간 방문→기기 저장 `{volume,page:2}`만→서고 이어 읽기→2구간 본문 복귀 통과(1280px 넘침 0).
  로그인 summary의 streak_days=0과 이번 주 메타 `연속 0일` 일치, 기존 WeekStrip 유지 확인.
  웹 담당 최종 248 tests·typecheck·build·CSS 검사 통과.
- 독립 리뷰 3차: 이전 검색 로그 P1은 closed, 신규 P2로 **FAIL**. Next 개발 서버의 `.next/dev/trace`에
  요청 쿼리가 저장됨을 발견했다(`/tmp/hoondok-review-3-output.txt`). 라운드 상한 3회에 도달했으므로
  추가 Codex 호출 없이 실제 디스크 trace 회귀와 검증 담당 독립 재현으로 닫았다(아래 증거).
  설치 Next 16.3.4가 읽는 span 임계값 `9007199254740991`로 개발 trace 기록을 억제했다. 공식 trace OFF 옵션은 아니다.
  적용 범위는 `pnpm --filter @truewords/web dev`(Makefile·E2E도 경유)이며 직접 next dev 실행은 우회한다.
- 최종 통합 `make ci`: **PASS** (pytest 1096 passed / 7 skipped / 1 xfailed, web 248·admin 119·SDK 13).
  PG opt-in 3건은 별도 1099 passed 근거와 구분한다. 계약 drift/호환·문서·lint·build·typecheck 완료.
  로그 `/tmp/hoondok-journey-ci-final.log`.
- UI·trace 보완 후 E2E: 89 passed / 1 failed. 신규 J4 답 문단의 인용 `<sup>1</sup>`을 제외한 exact-text
  locator가 원인이며 snapshot에는 답·근거 링크가 정상이다. 문단 contains로 수정 후 전체 재실행했다.
  이어 읽기 신규 E2E와 기존 원문 404·badge locator 4건은 통과했다.
- 최종 `make e2e`: **90 passed (1.8분), exit 0**. 실제 SSE→근거→원문, 서고·검색·원문 3폭,
  권리·구간 API, 개인화 날짜 전환·2/7·연속2, 이어 읽기, 프리뷰 API 0 및 기존 회귀 모두 통과.
  로그 `/tmp/hoondok-journey-e2e-final-rerun.log`. 격리 컨테이너·서버 정리 완료.
- 리뷰 3차 P2 독립 검증: 공식 web dev 스크립트를 별도로 시작해 upstream 미기동 상태에서 고유 API/UI
  sentinel을 보냈다. 신규 trace 없는 경우와 기존 marker 파일 있는 경우 각각 API 503/UI 200,
  stdout/stderr·종료 후 디스크 trace에 신규 sentinel **0**. 신규 trace 미생성, 기존 파일 바이트 변경 0.
  기존 실제 trace는 백업·원복했고 과거 내용을 삭제하지 않았다. 개발 성능 trace를 남기지 않는 대책이며
  Next 업데이트 때 동일 검증이 필요하다. 증거 `/tmp/hd005-independent-trace-evidence.json`.
  리뷰 1~3 발견 총 7건 모두 수정·개별 근거로 closed; 마지막 Codex 원문 판정 자체는 FAIL을 보존한다.
- 최종 구현 검증 시점: 문서 191개/로컬 링크 332개 오류 0, diff whitespace 검사 통과. 이 검증 시점에는 커밋·푸시·배포를 실행하지 않았다.
- 2026-09-21 후속 실행 승인: 사용자가 커밋·필요한 push·main 대상 PR 생성을 승인했다. 통합 트리의 108개 변경 파일이 검증 worktree와 일치함을 확인한 뒤 실행한다. PR merge·운영 배포는 이번 승인 범위가 아니다.

---

## 10. 산출물과 범위

### 10.1 산출물

- 로컬 통합 브랜치 `dev/hoondok-journey` 에 검토된 트랙별 변경 통합
- **main PR 1개.** push·PR 생성은 **사용자 승인 뒤**(Git Safety Protocol)
- 신규 테이블 3개·신규 API 그룹 6개를 단일 통합 PR로 검토한다. T7은 T2b와 T3b 완료 후 통합한다.
- 배포(`make deploy-*`)는 **비범위**. 결정 6(말씀 3화면 정식 노출)은 코드까지이고, 운영 반영은
  권리 원장에 저작물을 실제로 등록한 뒤 **별도 승인**으로 한다

### 10.2 비범위

- Phase 4 알림 · 약관·`DEC-PWA-001` 문구 · 비밀번호 재설정(메일 제공자 미정)
- 가정예배 4화면·가족 1화면의 실데이터화 — `DEC-PWA-020`·`021` 외부 결정 대기, 프리뷰 셸 유지
- **`pray`(기도하기) 미션** — 화면이 없다. 홈 3장 중 1장은 계속 비활성
- **형광펜·노트·북마크 서버 저장** — 원문 뷰에서 계속 표시만(비활성 + 사유 문구)
- **정성 결석 보호 아이템·연속 참여 보상·알림** — 후속 고도화. 선행 테이블·동작을 만들지 않는다.
  참고: [Duolingo Streak Freeze](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)
- 실기기 증거 — 사용자가 채운다(헤드리스로 대체 불가)
- Qdrant 417,579 포인트 재적재 · payload 확장 · 장·절 메타 신설
- `globals.css`·`/design-system`·시연 챗 변경 · 다크 팔레트
- 어떤 저작물을 `allowed` 로 올릴지 — 이 계획은 **판단의 틀**만 만들고 판단은 운영자가 한다
