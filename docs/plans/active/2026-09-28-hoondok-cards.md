# PLAN-HD-012 — 훈독 오늘의 책갈피

- 작성 2026-09-28. 기준 main `90f3a2b`. 통합 브랜치 `dev/hoondok-cards` ← 트랙별 sub-PR([통합 브랜치 runbook](../../runbooks/integration-branch-workflow.md)).
- 결정 원본: [PRD `DEC-PWA-024`](../../prd/17-ffwpu-pwa-prd.md) · 승인 시안 `~/Downloads/말씀카드/최종안/bookmark-final.html`(목업 A: 종이 카드·잎 그림자·감귤 리본, 책에서 책갈피를 꺼내는 모션). 시안·비교 문서는 저장소에 넣지 않는다.
- ID: 엔티티 `ENT-HD-019·020`, API `API-HD-047~052`, 화면 `SCR-PWA-022~026`, 결정 `DEC-PWA-024`.
- 표기: 라벨 없는 문장은 코드로 확인한 사실. `[가정]` 은 추론, `[확인 필요]` 는 사용자·외부 결정.

## 1. 결정 (2026-09-28 사용자 결정, 재논의 금지)

| # | 결정 |
|---|---|
| 1 | 인사 한 줄 칩·이름 토글은 넣지 않는다. 인사는 사용자가 카톡 대화방에서 직접 쓴다 |
| 2 | 새 알림 종류를 만들지 않는다. 기존 훈독하기 알림 1건의 `url` 을 `/hoondok/bookmark` 로 바꾸고 문구만 조정한다(하루 2건 금지) |
| 3 | 오늘 카드 = 그날 `pinned_on` 인 active 카드, 없으면 active 풀을 `(created_at, id)` 로 정렬해 `날짜 서수 mod 풀 크기`. 모든 사용자에게 같은 카드이고 편성자가 매일 입력하지 않아도 끊기지 않는다 |
| 4 | 건네기 1단계는 Web Share(`navigator.share` 파일 → url → 클립보드 폴백) + 2:1 OG 링크 카드. 카카오 SDK 는 앱 키 발급 뒤 2단계 |
| 5 | **외부 공유 권리 게이트 없음.** 공개 API(047·048)는 active 카드를 모두 내보낸다. 협회가 불허하면 웹 플래그 `NEXT_PUBLIC_HOONDOK_CARDS` 를 끄거나 카드를 retired 로 바꾼다(별도 설정 없음) |
| 6 | 원칙: 비처벌(연속일·열람 수 없음), 헌금 연결 금지, 말씀 원문 그대로(admin 도 본문 수정 불가), 터치 44px, 동작 줄이기면 페이드만 |

## 2. 구조

- **데이터** — `ENT-HD-019 word_cards`(본문·`volume`·`chunk_id`·`chunk_index`·`work_title`·`source_label`·`topic`·`status` draft/active/retired·`pinned_on` unique), `ENT-HD-020 card_receipts`(`user_id`·`card_id`·`received_on` KST·`shared_at`, unique `(user_id, card_id)`). alembic `t5e6f7a8b9c0`(down `s4d5e6f7a8b9`). 계정 삭제 purger 에 `card_receipts` 포함.
- **API** — [API 명세](../../specs/api/hoondok-api.md#plan-hd-012--오늘의-책갈피-api-hd-047052) 047~052. 오늘 카드는 풀이 비면 `card: null`(항상 200, `/hoondok/today` 관례).
- **시드** — `apps/api/scripts/seed_hoondok_cards.py`: 엑셀 `말씀카드_후보문구.xlsx` 11탭(말씀선집 제외) 문구를 Qdrant 청크와 한글 정규화 포함 검사로 대조해 draft 로 넣는다. 로컬·E2E 전용(운영 환경 거부). 2026-09-28 로컬 `malssum_poc_v5` dry-run: 590 중 일치 588 · 불일치 2(청크 경계에 걸친 문구 `[가정]`). E2E 는 `seed_hoondok_journey.py` 가 active 3장을 넣는다.
- **웹 화면** — `SCR-PWA-022` 홈 카드, `023` `/hoondok/bookmark` 받기·읽기, `024` 건네기 시트, `025` `/hoondok/c/{id}` 받은 사람(공개), `026` `/hoondok/bookmarks` 나의 책갈피. 원문 연결은 기존 `/hoondok/words/{volume}?chunk_id=&card={id}`(밑줄·여백 리본). OG 이미지 `/hoondok/c/{id}/image?f=link|square|story`(`next/og`, Pretendard TTF 서브셋). 비로그인은 localStorage KST 날짜 키에 두었다가 로그인 뒤 당일분을 소급한다.
- **알림** — `push_sender.py`: 중립형 "오늘의 책갈피가 꽂혀 있어요"(책 이름 없음), 신앙형 "오늘의 책갈피 — {책}에서 한 장"(오늘 카드를 모르면 "오늘의 말씀 책갈피가 꽂혀 있어요"), 본문 "한 장 꺼내 읽어 보세요". 태그 `hoondok-read` 유지.

## 3. 트랙

| 트랙 | 범위 | 상태 |
|---|---|---|
| A docs | 이 문서·ID·`DEC-PWA-024`·명세 한 줄씩 | 진행 |
| B API | 모델·마이그레이션·047~052·회전 순수 함수·시드·알림 페이로드·계약 재생성 | 진행 |
| C admin | 풀 목록·활성화·날짜 고정 | 대기(B 뒤 병렬) |
| D web 받기·읽기 | 홈 카드·023·원문 밑줄 | 대기 |
| E web 건네기 | OG 라우트 3종·024·025 | 대기 |
| F 책장·알림 | 026 · 설정 화면 문구 미리보기·`sw.js` 대체 제목 갱신 | 대기 |

## 4. 배포 순서

- 알림 `url` 이 `/hoondok/bookmark` 를 가리키므로 **web(트랙 D 라우트)을 backend 보다 먼저 또는 동시에** 배포한다. backend 만 먼저 나가면 알림을 누른 사용자가 404 를 본다.
- 같은 이유로 `NEXT_PUBLIC_HOONDOK_CARDS` 를 끈 상태에서는 `/hoondok/bookmark` 가 404 가 아니라 `/hoondok` 으로 보내도록 트랙 D 에서 처리한다 `[확인 필요]`.
- 순서: alembic `t5e6f7a8b9c0` → backend → 운영자가 카드 투입·active 전환 → web(플래그 ON).

## 5. 한계·[확인 필요]

- `[확인 필요]` 발송기는 지금도 "오늘 공식 편성 또는 진행 중 정성" 이 없으면 알림을 건너뛴다(`skipped_no_reading`). 편성이 소진된 날에도 책갈피는 있으므로 발송 조건을 "active 카드가 있음" 으로 넓힐지 정해야 한다(이번 변경은 문구·url 만).
- `[확인 필요]` 운영 카드 투입 절차(운영 Qdrant 대조 또는 admin 수기 등록)와 협회 저작권 확인(결정 5).
- 고정 카드도 다른 날에는 회전 풀에 들어간다. retired 카드는 공개 API·나의 책갈피 목록에서 모두 빠진다(이미 공유된 링크도 404).
- 모임에 카드 올리기는 범위 밖(모임 한 줄 나눔 모델 확장 필요).
