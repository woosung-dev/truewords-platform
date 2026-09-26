# PLAN-HD-011 — 훈독 AI 낭독 목소리

- 착수 2026-09-25. 기준 main `6b42a80`. 브랜치 `feat/hoondok-ai-voice`, 산출은 PR 1개(푸시·PR·배포·GCP 리소스 생성은 별도 승인).
- 상위: [`PLAN-HD-008`](2026-09-23-hoondok-reader-polish.md)의 브라우저 듣기(`useSpeechReader`)를 AI 목소리의 대체 경로로 둔다. API 는 [`API-HD-044~046`](../../specs/api/hoondok-api.md#plan-hd-011--ai-낭독-목소리-api-hd-044046), 엔티티는 [`ENT-HD-018`](../../specs/domain/hoondok-entities.md), 운영 절차는 [런북](../../runbooks/hoondok-pwa-rollout.md#ai-낭독-목소리-운영-on-plan-hd-011).
- 표기: 라벨 없는 문장은 코드·테스트로 확인한 사실. `[가정]` 은 검증이 필요한 추론, `[확인 필요]` 는 사용자·외부 결정.

## 1. 사용자 결정 (2026-09-25, 재논의 금지)

| # | 결정 |
|---|---|
| 1 | 목소리 4종, 모두 Google Chirp 3 HD · speakingRate 0.9 — `sulafat`(기본, 차분한 여성) · `aoede`(맑은 여성) · `algieba`(부드러운 남성) · `iapetus`(또렷한 남성) |
| 2 | 범위는 원문 뷰(`/hoondok/words/{volume}`) 한 화면. 2026-09-26 사용자 결정으로 오늘 훈독(`/hoondok/read`)의 듣기 바를 뺐다 — `API-HD-046` 은 남기되 화면에서 부르지 않는다 |
| 3 | 생성 방식은 처음 들을 때 단락 mp3 를 만들어 파일로 저장. 월 900,000자 상한, 넘으면 브라우저 음성으로 대체 |
| 4 | UI 는 "1안 조용한 목록" — 듣기 바의 목소리 칩 → 시트(목록 radiogroup·4초 견본·속도 0.8/1.0/1.2), 선택은 기기에 기억 |

## 2. 트랙·진행표

| 트랙 | 소유 파일 | 완료 기준 | 상태 |
|---|---|---|---|
| A API | `apps/api/app/modules/hoondok/tts_*.py` · `models.py`(`TtsUsage`) · alembic `s4d5e6f7a8b9` · `journey_service.chunk_display_text` · `tests/test_hoondok_tts.py` · 계약 재생성 | 캐시 적중·목소리별 분리·동시 1회 합성·월 상한·권리/편성/소유자 404·Google 재시도·오류 코드. `contracts:check` 추가만 | ✅ `627ffb3` · `b7e59ac`(캐시 실패 허용) |
| B 웹 | `apps/web/src/features/hoondok/library/tts/*` · `words-screen.tsx` · `jeongseong/components/effective-reading.tsx` · `_hoondok/library.css` · `public/hoondok/voices/*.mp3` · `src/test/hoondok-voice-reader.test.tsx` | 순차 재생·미리 받기·로딩·재생 중 목소리 변경·꺼짐/상한/비로그인/오류 대체와 안내, 시트 접근성. `hoondok:check` 통과 | ✅ `caacf92` |
| C e2e | `tests/e2e/hoondok-library.spec.ts` | 375px 에서 칩 → 시트 → 선택·속도 → Esc 포커스 복귀 → 요청 `voice=aoede` → 새로고침 뒤 유지 (API 스텁) | ✅ `7f55536` · `make e2e` 99 통과 |
| D 문서·운영 | 이 문서 · 런북 · API/엔티티 명세 · `infra/oracle-vm/docker-compose.yml` · `.env.example` · `docs/TODO.md` · 앱 `AGENTS.md` | docs-links 새 오류 0 | ✅ `0833fbf`(compose) · `4151aad`. `make ci` 통과(pytest 1317 · web Vitest 473) |
| E 독립 리뷰 반영 | A·B 소유 파일 + `apps/web/src/test/hoondok-voice-api.test.ts` + 이 문서·런북·명세 | 리뷰 P1 1건·P2 7건·참고 1건 전부. pytest(동시 상한·사용자 한도·부분 과금·타임아웃 무재시도·시간 상한·캐시 불가 OFF·PT 월 경계·끝난 정성) + Vitest(빈도 제한 재시도·대체 시 멈춤·일시 실패 비고정·방향키) | ✅ `49109c8`(API) · `e1aa9c0`(웹) · 이 커밋 |

## 3. 인수 조건

1. 클라이언트는 텍스트를 보내지 않는다 — 청크 id 또는 말씀 id + 단락 번호뿐이다. 서버가 권리(`scope_full_text`·`scope_jeongseong`)·편성 공개일·소유자를 확인한다.
2. 같은 목소리·같은 본문은 두 번째부터 저장본을 준다(`X-Tts-Cache: hit`, Google 호출 0). 동시 요청도 한 번만 합성한다.
3. 키가 없거나 캐시 디렉터리에 쓸 수 없으면 503 `TTS_DISABLED`, 월 상한이면 429 `TTS_QUOTA_EXCEEDED`, 사용자 24시간 한도면 429 `TTS_USER_LIMIT_EXCEEDED`, Google 실패는 502 `TTS_UPSTREAM_FAILED`, 45초 초과는 504 `TTS_TIMEOUT` 이다. 재생 중 이렇게 끊기면 웹은 기기 음성을 **그 단락에 멈춘 채** 두고 안내 한 줄을 보인다 — 사용자가 "이어 듣기" 를 누르면 거기서 읽는다(자동으로 말하지 않는다).
4. 요청 빈도 제한(429 `RATE_LIMIT_EXCEEDED`)은 일시적이다 — 웹이 짧게 두 번 재시도하고, 그래도 막혀 기기 음성으로 읽더라도 다 읽거나 멈추면 다음 재생은 AI 로 다시 시도한다(받기 실패 `error` 도 같다).
5. 서로 다른 단락이 동시에 와도 월 상한·사용자 한도를 넘지 않는다 — 상한 검사와 글자 수 예약이 한 락 안에서 커밋되고, Google 호출은 그 뒤 DB 커넥션 없이 한다. 합성 실패 시 Google 이 과금했을 수 있는 글자 수만 남는다.
6. 목소리 시트: 칩 `aria-haspopup`·`aria-expanded`, radiogroup·체크 하나(Tab 은 고른 줄 하나만, 방향키로 이웃 줄 선택), 줄을 누르면 즉시 선택 + 4초 견본, Esc·바깥으로 닫고 포커스는 칩으로. 터치 대상 44px 이상.
7. 재생 중 목소리를 바꾸면 현재 단락부터 새 목소리로 읽는다. 속도는 재생 속도(`playbackRate`)라 새로 합성하지 않는다.
8. 정성 말씀은 화면과 같이 진행 중 기간의 오늘 말씀만 합성한다.
9. 테스트는 Google 을 부르지 않는다.

## 4. 한계·[가정]

- [가정] backend 는 uvicorn 단일 워커라 프로세스 락(같은 키 합성 1회·상한 검사+예약 직렬화)으로 충분하다. 워커를 늘리면 DB 락(예: 월 행 `SELECT … FOR UPDATE`)이 필요하다.
- [가정] 사용자 한도 3만 자/24시간 ≈ 원문 구간 15~20개. 실제 청취량을 보고 조정한다.
- [가정] 시간 초과(45초)는 어디까지 합성됐는지 몰라 예약한 글자 수를 그대로 남긴다 — 덜 세기보다 더 세는 쪽이다.
- [가정] iOS Safari 의 재생 제스처 제한은 첫 탭에서 무음 WAV 를 재생해 풀고, 대체 경로는 자동 발화 없이 멈춰 둔다. 실기기에서 확인하지 않았다.
- 캐시 파일은 지우지 않는다. 볼륨 용량은 런북의 점검 절차로 본다.

## 5. [확인 필요]

- 운영 TTS 키 발급(GCP `gcp-project-504004`, Text-to-Speech API 한정 키)과 GCP 예산 알림 설정(런북 0-1).
- 협회 본문을 Google Cloud 로 보내 합성하는 것에 대한 협회 확인.
- 운영 VM 캐시 디스크 용량 점검 주기, backend 컨테이너 appuser uid 실측.

## 6. 결정 기록

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-09-25 | 키는 쿼리 `?key=` 대신 `X-Goog-Api-Key` 헤더 | 접근 로그·예외 메시지에 키가 남지 않게 |
| 2026-09-25 | 캐시 쓰기 실패는 듣기를 막지 않는다 | 볼륨 권한·디스크 부족이 사용자 오류로 번지지 않게. 사용량은 그대로 세어 상한이 비용을 막는다 |
| 2026-09-25 | 견본은 정적 mp3(5초·40kbps mono) | 시트를 열 때마다 합성·과금하지 않게 |
| 2026-09-25 | 합성 전에 글자 수를 예약·커밋(전역 락), 실패 시 과금 가능분으로 정산 | 리뷰 P1·P2 — 동시 요청이 옛 합계를 보고 상한을 넘던 문제, 부분 성공·타임아웃 재시도 과금 누락, Google 호출 동안 커넥션 점유 |
| 2026-09-25 | 사용자 최근 24시간 한도 추가(`TtsUsage.user_id`), IP 한도는 분당 600 으로 완화 | 한 계정이 그달 몫을 다 쓰는 것을 막고, 한 IP 를 함께 쓰는 모임이 막히지 않게 |
| 2026-09-25 | 읽기 타임아웃은 재시도하지 않는다. 요청 전체 45초 상한 | 이미 과금됐을 수 있는 요청을 두 번 보내지 않게. Cloudflare 100초보다 먼저 끊는다 |
| 2026-09-25 | 캐시 디렉터리에 쓸 수 없으면 기능 OFF | 매 청취가 새 합성으로 세어져 한도를 조용히 쓰지 않게(안전한 쪽으로 닫기) |
| 2026-09-25 | 월 경계를 America/Los_Angeles 로 | Google Cloud 청구 달과 맞춘다 — UTC 면 청구 한 달에 앱 상한 두 번이 들어갈 수 있다 |
| 2026-09-25 | 대체 경로는 자동 발화 없이 멈춰 두고, 일시적 실패(빈도 제한·받기 실패)는 고정하지 않는다 | iOS 가 제스처 밖 첫 발화를 막을 수 있다. 잠깐의 제한으로 방문 내내 기기 음성이 되지 않게 |
