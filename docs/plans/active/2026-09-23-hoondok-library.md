# PLAN-HD-007 — 말씀 서고 3계층 (저작물 → 권 → 장) + 읽기 기록

- 착수 2026-09-23. 기준 main `d41aeb1`. 통합 브랜치 `dev/hoondok-library`, 산출은 dev→main **PR 1개**.
- 상위: [`PLAN-HD-005`](../completed/2026-09-21-hoondok-journey-plan.md)(서고·검색·원문 실데이터 개통) 의 후속. 화면은 [`SCR-PWA-007/008/009`](../../prd/17-ffwpu-pwa-prd.md), 규격은 [`DES-PWA-003` §4.3](../../specs/web/hoondok-design-system.md).
- 이 문서는 오케스트레이터가 소유한다 — 트랙 서브에이전트는 편집하지 않는다.
- 표기: 라벨 없는 문장은 코드·데이터로 확인한 사실. `[가정]` 은 검증이 필요한 추론, `[확인 필요]` 는 사용자·외부 결정.

## 1. 왜 지금, 무엇을 바꾸는가

서고·검색·원문 뷰는 `PLAN-HD-005` 로 이미 실데이터(API-HD-014~016)에 붙어 있고 운영에 배포돼 있다. 그런데 운영 서고는 비어 있고(`content_rights` 0행 — 권리 게이트 기본값이 전부 비노출), 화면도 프로토타입보다 얕다.

| 프로토타입(정본) | 현재 구현 | 원인 |
|---|---|---|
| 저작물(천성경·말씀선집…) → 권 → 장 3계층 | volume(파일) 664개 평면 목록 | Qdrant payload 에 `book_series`·`title` 이 비어 있다(운영 `malssum_poc_v5` = 로컬 사본, 2026-09-23 실측). 장 계층은 어디에도 없다 |
| 이어 읽기 "12단락까지 읽었어요" | 기기 localStorage 만 | 서버 저장 없음 |
| 형광펜·노트·북마크 | 버튼만 있는 `ReaderBar` | 저장 수단 없음 |
| 본문 단락 번호(`.verse__n`) | `body` 문자열 한 덩이 | `chunks[]` 를 받고도 쓰지 않음 |
| 본문 / AI 설명 / 노트 3탭 | 탭 껍데기 | — |

**2026-09-23 실측 — 장 계층은 수기 없이 본문에서 뽑을 수 있다.** 로컬 Qdrant(운영 사본 417,579 청크·664 volume)로 확인한 구조 신호:

| 저작물 | 신호 | 표본 결과 |
|---|---|---|
| 말씀선집 615권 | 권마다 `차례` 청크 · 페이지 머리글 `"10   승리하는 하나님의 정병이 되자"` · 설교 끝 서명 `"1956년 4월 8일(日), 전 본부교회."` | 20권 표본: 차례 제목 111개 중 104개가 머리글과 일치, 날짜 서명 204개 |
| 천성경 | `제1편 하나님` / `제1장 하나님의 존재와 속성` 본문 헤딩 | 편·장 2단 |
| 평화경 | `제N편` + 번호 설교 `"1. 하나님과 인간을 위한 이상세계 (1972.2.4)"` | 편·설교 2단 + 날짜 |
| 원리강론 · 통일사상요강 | `제1장 / 제1절 / 1.` | 장·절 2단(`1.` 은 소제목이라 목차에서 제외 `[가정]`) |

## 2. 확정값 (사용자 결정 2026-09-23)

| # | 항목 | 값 | 근거 |
|---|---|---|---|
| 1 | 권리 원장 채우기 | **시드 스크립트**(Qdrant volume → `content_rights` 행) **+ admin 승인**. 수기 665건 입력은 하지 않는다 | 사용자 결정 |
| 2 | 서고 계층 | **저작물 → 권 → 장 3계층.** 장은 수기 입력 없이 본문 규칙으로 자동 추출, Postgres 보조 테이블에 저장. 미검출 구간은 지금처럼 "구간 N" 폴백 | 사용자 결정 · §1 실측 |
| 3 | 저작물 범위 | **명확한 6시리즈만** 원장에 등록: 말씀선집(615)·천성경·평화경·원리강론·통일사상요강·자서전(`평화를 사랑하는 세계인으로`). 참어머님 말씀 36파일·기타 8파일은 **등록하지 않는다**(후속, TODO) | 사용자 결정 |
| 4 | 초기 노출 | 시드가 **천성경·평화경·원리강론** 3권만 `allowed + scope_search + scope_full_text` 로 넣고, 나머지는 `pending`. 말씀선집·통일사상요강·자서전 노출은 admin 에서 **시리즈 일괄 승인** 으로 운영자가 고른다 | 사용자 결정 |
| 5 | 승인 도구 | admin 권리 화면에 **시리즈 필터 + 일괄 승인/철회(범위 체크)** 버튼, API 1개 | 사용자 결정 |
| 6 | 읽기 기록 | **북마크 + 이어 읽기(서버 저장) + 형광펜·노트** 전부 이번 범위. 기록은 로그인(`hoondok_token`) 필수, 읽기는 비로그인 허용 | 사용자 결정 · PRD `SCR-PWA-009` "비로그인 읽기, 기록은 로그인" |
| 7 | AI 설명 탭 | 이번 범위. 기존 `POST /chat/stream`(훈독 질문과 같은 봇) 재사용, **사용자가 단락을 골라 요청할 때만** 생성, 저장하지 않는다 | 사용자 결정 · 비용은 요청당 |
| 8 | TTS · 판본 나란히 보기 | **비범위.** 판본 데이터·음성 인프라 없음. TODO 후속 | 사용자 결정 |
| 9 | 운영 배포 순서 | backend → admin → VM 에서 시드·목차 추출 → **운영자 승인 완료 후** web 배포. 빈 서고를 사용자에게 노출하지 않는다 | 사용자 결정 |
| 10 | 시리즈 판정 `[가정]` | 파일명 규칙(`pipeline/metadata.py:47 _BOOK_SERIES_RULES` 재사용) — `말씀선집` / `천성경` / `평화경` / `원리강론` / `통일사상요강` / `평화를 사랑하는 세계인으로`. volume 키는 Qdrant 원문 그대로(`"말씀선집   001권.pdf"`, 공백·확장자 포함) | 664 volume 전수 분류 결과 6시리즈 620 + 참어머님 36 + 기타 8 |
| 11 | 권위 등급 시드값 `[확인 필요]` | 천성경·평화경·원리강론은 `O1`, 말씀선집·통일사상요강·자서전은 `pending` 이라 등급도 운영자가 admin 에서 정한다(기본 `R`) | 프로토타입 배지 "O1 공식 원문". 등급 정책은 `REQ-PWA-012` |
| 12 | 단락 = 청크 | 원문 뷰 단락 번호·북마크·형광펜·노트의 단위는 **Qdrant 청크(`chunk_index`)** 다. 청크 안 부분 선택은 하지 않는다 `[가정]` | 프로토타입 `.verse__n` 단락 번호 · 검색 결과가 이미 `chunk_id` 로 원문에 진입 |
| 13 | 이어 읽기 병합 `[가정]` | 서버 값이 있으면 서버 우선, 없으면 기기 값 1회 업로드. 비로그인은 기기 값만 | 단순 규칙 |

## 3. 범위

### 테이블 3 (additive-only, PG ENUM 금지, alembic 1개 `down_revision="m7c8d9e0f1a2"`)

| ID | 테이블 | 열 | 비고 |
|---|---|---|---|
| `ENT-HD-010` | `volume_sections` | `id` · `volume`(index) · `position` int · `level` 1\|2 · `title`(200) · `start_chunk_index` · `end_chunk_index` · `spoken_on`(32, nullable) · `place`(120, nullable) · `origin` `auto\|manual` · `created_at`·`updated_at` | `(volume, position)` unique. 추출 스크립트가 `origin='auto'` 행을 전량 교체, `manual` 은 보존 |
| `ENT-HD-011` | `reading_positions` | `user_id` FK · `volume` · `chunk_index` · `updated_at` | `(user_id, volume)` unique. 이어 읽기 |
| `ENT-HD-012` | `passage_marks` | `id` · `user_id` FK(index) · `volume` · `chunk_id`(128) · `chunk_index` · `kind` `bookmark\|highlight` · `color` 1~3 nullable · `note` Text nullable · `created_at`·`updated_at` | `(user_id, chunk_id, kind)` unique. 노트는 highlight 의 `note` 로 둔다(프로토타입 "노트 3" 탭은 note 가 있는 표시만 모은 것) `[가정]` |

계정 하드 삭제(API-HD-011): `identity/dependencies.py:48 get_user_data_purgers` 에 `reading_positions`·`passage_marks` purger 등록.

### API (prefix `/hoondok`, 라우터→서비스→리포지토리, 기존 `journey_*` 패턴)

| ID | 메서드·경로 | 인증 | 동작 |
|---|---|---|---|
| `API-HD-014` 확장 | `GET /hoondok/library` | 공개 | 응답에 `works[]` 추가 — `book_series` 로 묶은 저작물(`series`·`title`·`volume_count`=시리즈 등록 행 수·`allowed_count`=허용 행 수·`authority_grade`·`scope_*` 집계). `items[]` 는 그대로(호환) |
| `API-HD-023` | `GET /hoondok/library/{series}` | 공개 | 시리즈의 허용 권 목록: `volume`·`label`("001권" 등 표시명)·`total_chunks`·`section_count`. 허용 0건이면 404 |
| `API-HD-024` | `GET /hoondok/sections/{volume}` | 공개 | `volume_sections` 목록(level·title·start/end·spoken_on). 권리 게이트는 `API-HD-016` 과 같다. 0건이면 `[]`(프런트가 "구간 N" 폴백) |
| `API-HD-016` 확장 | `GET /hoondok/words/{volume}?section=` | 공개 | `section`(position) 을 주면 `start_chunk_index // 20 + 1` 페이지로. 응답에 `section`(현재 장 제목·position) 동봉 |
| `API-HD-025` | `GET /hoondok/me/reading-positions?volume=&limit=` · `PUT /hoondok/me/reading-position/{volume}` | `hoondok_token`(PUT 은 CSRF) | 이어 읽기 목록(최근 N개, `volume` 필터로 단건) · upsert |
| `API-HD-026` | `GET /hoondok/me/marks?volume=` · `PUT /hoondok/me/marks/{chunk_id}` · `DELETE /hoondok/me/marks/{chunk_id}?kind=` | `hoondok_token` + CSRF | 북마크·형광펜·노트 upsert/삭제. `GET /hoondok/me/marks?kind=bookmark` 로 서고 "북마크" 절 |
| `API-HD-027` | `POST /admin/hoondok/content-rights/bulk` | admin + 게이트 + CSRF | `{book_series, status, scope_search, scope_full_text, scope_jeongseong, authority_grade?}` — 시리즈 전 행 갱신, 감사 로그 1건(`content_right.bulk`) |
| `API-HD-028` | `GET /admin/hoondok/content-rights/series` | admin + 게이트 | 시리즈별 `registered`·`allowed`·`pending`·`withdrawn` 수 |

### 스크립트 2 (`apps/api/scripts/`, `refresh_suggested_questions.py` 구조: argparse `--dry-run/--execute`, exit 0/1)

- `seed_content_rights_from_qdrant.py` — Qdrant `volume` facet(`datasource/qdrant_service.py:125 get_all_volumes` 재사용) → 6시리즈 분류 → `content_rights` upsert(**이미 있는 행은 status·scope 를 건드리지 않는다**, `work_title`·`book_series` 만 보정). `--allow "천성경,평화경,원리강론" --grade O1` 이 초기 3권을 연다. 참어머님·기타는 건너뛰고 stdout 에 목록만 낸다.
- `extract_volume_sections.py` — 시리즈별 규칙으로 `volume_sections` 생성. `--volume` 1권 · `--series` · 전체. `--dry-run` 은 커버리지 보고(권별 장 수·미검출 권 목록)만.
  - 말씀선집: 설교 경계 = 날짜 서명 줄(`^\d{4}년 \d{1,2}월 \d{1,2}일`)이 있는 청크 끝. 제목 = 머리글(`^\d{1,3}\s{2,}제목$`) → 차례 항목 → 경계 다음 청크 첫 줄 순 폴백. `spoken_on`·`place` 는 서명 줄에서.
  - 천성경·평화경: `제N편`(level 1) / `제N장` 또는 `N. 제목 (yyyy.m.d)`(level 2). 앞머리 차례·머리말 청크는 본문 헤딩이 처음 나오는 청크 이전이면 제외.
  - 원리강론·통일사상요강: `제N장`(1) / `제N절`(2).
  - 자서전: 헤딩 규칙은 구현 착수 시 본문 표본으로 정한다 `[가정]`. 규칙이 안 잡히면 장 0건으로 두고 "구간 N" 폴백.
  - 인수 기준 `[가정]`: 말씀선집 표본 20권 설교 경계 검출률 ≥85% · 천성경 편 10/장 전수 · 원리강론 장 전수. 미달 시 규칙 보강, LLM 은 쓰지 않는다.
- VM 실행은 `infra/oracle-vm/refresh-questions.sh` 와 같은 `docker compose --env-file .env exec -T backend python scripts/...` 1회 실행이다(cron 아님). 절차는 rollout runbook 에 추가.

### web (`apps/web`, 훈독 CSS 규칙 `hoondok:check` 유지, 토큰 변경 0)

- `/hoondok/library` — 저작물 카드(`.shelf` 2열, 제목·권 수·권리/등급 배지) → `/hoondok/library/[series]` 권 목록(신규 라우트, `screens.ts`·`observability/report.ts` allowlist 등록) → `/hoondok/words/[id]`. 이어 읽기 카드는 서버 값 우선(§2-13), 북마크 절은 `GET /me/marks?kind=bookmark` 최근 5개.
- `/hoondok/words/[id]` — `aside.toc` 를 `sections` 로(0건이면 "구간 N" 유지), ≥1224px 상시 노출 규격 유지. 본문은 `chunks[]` 를 `.verse` 단락(번호 = `chunk_index`)으로. 리더 바 5칸 중 **형광펜(3색)·노트·북마크·목차** 동작, 설정은 그대로 비활성 `[가정]`. 단락 탭 → 시트(`.sheet`)에서 형광펜 색·북마크·노트 입력. 비로그인이면 시트에 "로그인하면 기록이 남아요" 안내(`onboardingHref`).
- 3탭: **본문** / **AI 설명**(단락 선택 → "이 단락 설명 요청" → `ask-stream.ts` 의 `/chat/stream` 재사용, 라벨 "AI 설명 · 공식 해설 아님", 저장 없음) / **노트**(note 가 있는 표시 목록).
- `/hoondok/read`·검색은 변경 없음(검색 결과의 `chunk_id` 진입은 그대로).

### admin (`apps/admin`)

- `/hoondok/rights` — 상단 시리즈 요약 표(`API-HD-028`) + 시리즈 필터 + **일괄 승인/철회 다이얼로그**(status·scope 3·등급) → `API-HD-027`. 기존 개별 폼 유지.

### 문서 (Atomic Update)

- 이 문서 · `docs/README.md` 색인 · `docs/TODO.md`(§훈독: 권리 원장 항목을 이 계획으로, 후속 3건 기록) — 트랙 0.
- `docs/specs/api/hoondok-api.md`(API-HD-023~028 + 014/016 확장) · `docs/specs/domain/hoondok-entities.md`(ENT-HD-010~012) — 트랙 A.
- `docs/specs/web/hoondok-design-system.md` 결정 기록 1줄(단락 = 청크, 장 목차 폴백) — 트랙 B.
- `docs/runbooks/hoondok-pwa-rollout.md` "서고 개통 절차"(시드 → 추출 → admin 승인 → web 배포) — 트랙 0 마지막.

## 4. 트랙·파일 소유 (오케스트레이터 모드, 서브에이전트 `model: opus`, worktree)

| 트랙 | 브랜치 | 소유 파일 | 완료 기준 | 상태 |
|---|---|---|---|---|
| 0 문서 | `dev/hoondok-library` 직접 | 이 문서 · `docs/README.md` · `docs/TODO.md` · runbook | docs-links 새 오류 0 | 🔄 계획 `9f0b396`, runbook 은 마지막 |
| A 백엔드 | `feat/hoondok-library-api` | `apps/api/**`(models·alembic·`journey_*`·신규 `library_*`·`marks_*`·`rights_admin_router`·tests) · `contracts/` · `packages/api-client-ts/src/generated` · `hoondok-api.md`·`hoondok-entities.md` | pytest: works 집계 · series 404 · sections 게이트 · section→page · position upsert · marks upsert/삭제/타인 불가 · bulk 감사 1건 · purger 등록 · `contracts:check` 추가만 | ✅ 머지(4커밋 `c9f8738`~`c3306d6`) — pytest 1181/7/1, contracts 추가만, 신규 테스트 22 |
| D 추출·시드 | `feat/hoondok-library-scripts` (A 스택) | `apps/api/scripts/{seed_content_rights_from_qdrant.py,extract_volume_sections.py}` · `apps/api/tests/test_extract_volume_sections.py` · `infra/oracle-vm/README.md` cron 표 옆 "1회 실행" 절 | 규칙 단위 테스트(고정 텍스트 표본) · 로컬 Qdrant(:6333) 대상 `--dry-run` 커버리지 보고가 §3 인수 기준 충족 | ⬜ |
| B web | `feat/hoondok-library-web` (A 계약 스택) | `app/(hoondok)/hoondok/library/**` · `app/(hoondok)/hoondok/words/**` · `features/hoondok/library/**` · `_hoondok/library.css`(신규) · `observability/report.ts`(allowlist) · `screens.ts`(라우트 1줄, 예외 허용) · `src/test/hoondok-library*.test.tsx` · `tests/e2e/hoondok-library.spec.ts` | Vitest: 저작물→권→원문 · sections 0건 폴백 · 단락 렌더 · 마크 upsert 페이로드 · 비로그인 안내 · AI 설명 요청 1회 · E2E(hoondok-chromium) 라이브 왕복 | ⬜ |
| C admin | `feat/hoondok-library-admin` (A 계약 스택) | `apps/admin/src/app/(dashboard)/hoondok/rights/**` · `apps/admin/src/features/hoondok/**` · admin Vitest · `tests/e2e/hoondok-curation.spec.ts`(권리 절 추가) | 시리즈 요약 렌더 · 일괄 다이얼로그 → bulk 페이로드 · 감사 로그 확인 | ⬜ |

순서: A → (D ∥ B ∥ C). **공유 파일(트랙 편집 금지)**: `apps/web/src/app/hoondok.css`(토큰), hoondok `layout.tsx`, `features/hoondok/{tabs,flag}.ts`, `components/hoondok/*`, `Makefile`, `main.py`(A 만). 필요 시 보고만 하고 오케스트레이터가 처리한다. 태스크 종료마다 이 표를 **먼저** 갱신한다.

## 5. 검증 게이트

1. 트랙별 `--no-ff` 로컬 머지 → 2. `make ci`(pytest 기준선 1159 passed 이상 · web Vitest 282 · admin 119) → 3. `make e2e`(92 이상) → 4. `node tooling/checks/hoondok-css.mjs` → 5. 독립 리뷰 ≤2회 → 6. dev→main PR(사용자 승인 후 push).
7. **로컬 라이브**: `docker compose -p backend -f apps/api/docker-compose.yml up -d qdrant postgres`(운영 사본 Qdrant :6333) → `alembic upgrade head` → `seed_content_rights_from_qdrant.py --execute --allow "천성경,평화경,원리강론" --grade O1` → `extract_volume_sections.py --execute` → 내장 브라우저로 `/hoondok/library` 저작물 3 → 천성경 권 → 편·장 목차 → 단락 북마크 → 새 기기(시크릿) 로그인 후 이어 읽기 복귀. 375·768·1280 3폭.

## 6. 운영 개통 절차 (머지 뒤, 단계별 승인)

1. `make deploy-backend`(alembic `n…` 적용) → 2. `make deploy-admin` → 3. VM `compose exec backend python scripts/seed_content_rights_from_qdrant.py --execute --allow … --grade O1` → 4. `extract_volume_sections.py --execute`(커버리지 stdout 을 runbook 에 기록) → 5. **운영자가 admin `/hoondok/rights` 에서 말씀선집 등 나머지 시리즈 일괄 승인** → 6. `make deploy-web … HOONDOK_ENABLED=1` → 7. `smoke-web` + `GET /hoondok/library` works ≥3 확인.

## 7. 진행 기록

| 시각 | 사건 | 결과 |
|---|---|---|
| 2026-09-23 | 조사: 서고·검색·원문은 PLAN-HD-005 로 실데이터 개통 상태, 운영 원장 0행 확인. 로컬 Qdrant(운영 사본)로 payload `book_series`·`title` 비어 있음, 본문 헤딩·차례·날짜 서명 신호 실측(§1) | 사실 확정 |
| 2026-09-23 | 인터뷰 2회 → §2 확정값 1~9 | 확정 |
| 2026-09-23 | 계획 리뷰 승인 + `[가정]` 3건(O1 시드·단락=청크·노트=형광펜 메모) 그대로 확정 → 트랙 A 착수(opus worktree) | 진행 |
| 2026-09-23 | A 완료·머지 — 라우트 11개(위 표) · purger 는 `LibraryRepository` 1개 · `format:check` 기존 결함 3파일은 범위 밖 `[확인 필요]` · `GET /hoondok/sections` 가 원문과 120회/분 예산 공유 `[확인 필요]` → D·B·C 병렬 착수 | 완료 |
| 2026-09-23 | A 사전 조사 반영 — `words/{volume:path}` 가 greedy 라 목차는 `GET /hoondok/sections/{volume}` 로 · 이어 읽기 단건은 목록 `?volume=` 필터로 · `volume_count` 는 등록 행 수 · bulk 감사 `target_id` 는 대표 행 id | 계약 정정 |

## 8. 결정 기록

| 날짜 | 결정 | 근거·영향 |
|---|---|---|
| 2026-09-23 | 장 계층은 **본문 규칙 자동 추출**, LLM·수기 입력 없음. 미검출은 "구간 N" 폴백 | Qdrant 원본만이 본문의 유일한 저장소이고 헤딩 신호가 충분(§1). 재실행 가능·비용 0 |
| 2026-09-23 | 원장 등록 범위 = 6시리즈, 초기 노출 = 천성경·평화경·원리강론. 나머지 시리즈는 admin 일괄 승인 | 사용자 결정. 참어머님 36·기타 8 은 후속(TODO) |
| 2026-09-23 | 단락 단위 = 청크. 노트는 highlight 의 `note` | 부분 선택은 검색·인용 체계(`chunk_id`)와 어긋난다 |
