# PLAN-HD-003 — 편성 후보 찾기 (추출형)

- 착수·구현: 2026-09-20. 상위 계획은 [`PLAN-HD-001`](2026-09-17-hoondok-mvp.md) 결정 5(편성은 운영자 수기 입력·대체 생성 없음)이며 **이 계획은 그 결정을 바꾸지 않는다.**
- 범위: 편성자가 코퍼스에서 후보를 찾아 폼을 채우는 것까지. 무엇을 편성할지는 사람이 정한다.

## 왜

편성 병목은 본문을 만드는 일이 아니다. 말씀 615권 · `malssum_poc_v5` 417,579 청크가 **이미 있다.** 병목은 그중에서 "오늘 읽기 좋은 한 편"을 고르는 일이고, 그건 사람이 손으로 훑기에는 너무 크다. 2026-09-20 기준 운영 편성 재고가 0일분이었던 것도 생산 능력이 아니라 이 탐색 비용 때문이다 `[가정]`.

그래서 AI 가 할 일은 생성이 아니라 **탐색 공간 축소**다 — 417,579 → 10~20건.

## 무엇을 하지 않는가

| 하지 않음 | 이유 |
|---|---|
| 생성형 초안 + 승인 큐 | `PLAN-HD-001` 결정 5(대체 생성 없음)를 뒤집는다. 교리 주장 recall 이 GPT-4o 56% · Gemini 2.5 Flash 42% 로 낮고 오류가 교단 차이 영역에 몰린다. 초안이 빨라지면 병목이 승인으로 옮겨갈 뿐이다 |
| 본문 요약·재작성 | 추출형 계약 위반. 본문은 언제나 코퍼스 원문이다 |
| 테마 커리큘럼 배치 편성 | 이 단계 위에 얹을 후속. 지금은 단건부터 |
| 수요 역방향 편성 제안 | 베타 `[가정]` 10~20명에는 표본이 없다 |
| `authority_grade` 자동 판정 | 권리·공식성은 사람이 판단한다. 후보는 항상 `R`(권리 확인 중)로 들어간다 |

## 구현

| 층 | 파일 | 내용 |
|---|---|---|
| 순수 로직 | `apps/api/app/modules/hoondok/candidates.py` | 카드 적합성 판정(종결어미·페이지 조각·파일명 leak), 출처 라벨, 권 정리, 제목·화자 제안. 규칙은 `scripts/extract_malssum_candidates.py`·`scripts/seed_daily_readings.py` 재사용 |
| 서비스 | `hoondok/service.py` `DailyReadingCandidateService` | 기존 `hybrid_search`(dense+sparse RRF) 호출 → 길이·적합성 필터. 외부 장애는 502 |
| API | `hoondok/admin_router.py` `GET /candidates` | [API-HD-012](../../specs/api/hoondok-api.md). **`/{reading_id}` 앞에 등록** |
| 화면 | `apps/admin/src/features/hoondok/components/candidate-panel.tsx` | 검색어 + 출처 체크박스 → 카드 목록 → "이 말씀으로 채우기" |
| 폼 연결 | `features/hoondok/form.ts` `fromCandidate()` · `hoondok/new/page.tsx` | 후보 → 폼 값. 폼은 uncontrolled 라 `key` 로 다시 마운트하고 편성일만 따로 추적한다 |

테이블 변경 없음. `chunk_id`·`source_note`·`review_status` 는 `ENT-HD-002` 에 이미 있던 컬럼이다.

## 되돌리기

기능이 문제가 되면 **지운다.** 되돌리기가 싼 것이 이 설계의 성질이다:

- 화면에서 `<CandidatePanel/>` 한 줄을 빼면 편성 흐름이 2026-09-19 상태로 돌아간다.
- `GET /candidates` 라우트를 지워도 편성 CRUD(API-HD-006~008)는 무관하다.
- 이미 등록된 편성은 그대로 남는다 — 본문이 원문이고 `chunk_id` 는 메모일 뿐이라 이 기능에 묶여 있지 않다.

마이그레이션이 없으므로 롤백에 DB 작업이 없다.

## 실측으로 보강한 판정 규칙 (2026-09-20)

운영 코퍼스 3,600 청크(카테고리 B·O·M scroll, 읽기 전용)에 초안 규칙을 돌려 결과를 눈으로 봤다. 종결어미만 보는 규칙으로는 아래가 전부 통과해 버렸다:

| 실제로 통과한 쓰레기 | 예 | 추가한 규칙 |
|---|---|---|
| 편집 표기·지문 | `[편집자주: 천원사 출판국에서 교정교열했습니다]` | 대괄호 배제 |
| 대화 조각 | `대복이 있습니다.」응, 이대복 그런 사람들이에요` | `「」『』` 배제 |
| 문장 중간 시작 | `의 장자라구요`, `인 입장에서 승리적 기반을` | 선행 조사 `[의을를가인]` 배제 |
| 헤더 + 본문 혼합 | 기사 제목 + 빈 줄 + 본문 | `\n\n` 배제 |
| 노트 헤더 | `# 천애축승자 서약식` | 선행 `#` 배제 |
| 같은 말씀 중복 | `참어머님 말씀(2017년)` 과 `-수정` 판 | 본문 해시 dedupe |

통과율은 **0.7%** 다(3,600 → 25건). 낮지만 이 방향이 맞다 — 편성자가 쓰레기를 걸러 내는 시간보다 서버가 넉넉히 받아 거르는 편이 싸다. 그래서 over-fetch 를 `limit × 12`(최대 300)로 올렸다. 다만 이 수치는 **scroll(무작위 순회) 기준**이고 실제 기능은 의미 검색 상위 결과를 쓰므로 운영 통과율은 다를 수 있다 `[가정]`.

각 규칙은 `tests/test_hoondok_candidates.py::test_is_card_worthy` 에 실제 패턴 그대로 회귀 테스트로 박아 뒀다.

## 검증 증거 (2026-09-20)

| 항목 | 결과 |
|---|---|
| `make ci` | 전부 통과 |
| pytest | 1069 passed / 4 skipped / 1 xfailed |
| admin Vitest | 116 passed (18 파일) |
| web Vitest · api-client-ts | 208 · 13 passed |
| lint | 0 errors (경고 3건은 기존 파일 `analytics/queries`·`lib/api.ts`) |
| `node tooling/checks/docs-links.mjs` | 새 오류 0 |
| 계약 | `pnpm contracts:generate` — 추가만(하위 호환) |

추출형 계약은 테스트가 고정한다 — `test_body_is_verbatim_from_corpus`(backend)와 `fromCandidate 는 본문을 원문 그대로 넣는다`(admin). 깨지면 설계가 바뀐 것이다.

## 열린 항목

- `[확인 필요]` 권리(저작권). [PRD `DEC-PWA-004~010`](../../prd/17-ffwpu-pwa-prd.md)이 "권리 승인 정본"을 전제하고 "권리 확인 전 615권 전체 공개"는 비범위다. `PLAN-HD-001` 결정 6 의 "LICENSE 미결"이 `featured_malssum.json` 20건 고유 문제인지 코퍼스 전체 문제인지 아직 답이 없다. **사용자 판단(2026-09-20): 문제가 되면 기능을 지운다.** 그때까지 후보는 `R`·`unverified` 로만 들어간다.
- 실제 편성 품질 측정: `chunk_id` 유무로 "후보에서 고른 편성" 과 "직접 찾은 편성" 의 완료율을 나중에 비교할 수 있다. 지금은 표본이 없다.
- 운영 반영: 이 기능을 쓰려면 backend·admin 배포가 필요하다. 각 단계 별도 승인.
