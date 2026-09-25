# PLAN-HD-011 — 훈독 AI 낭독 목소리

- 착수 2026-09-25. 기준 main `6b42a80`. 브랜치 `feat/hoondok-ai-voice`, 산출은 PR 1개(푸시·PR·배포·GCP 리소스 생성은 별도 승인).
- 상위: [`PLAN-HD-008`](2026-09-23-hoondok-reader-polish.md)의 브라우저 듣기(`useSpeechReader`)를 AI 목소리의 대체 경로로 둔다. API 는 [`API-HD-044~046`](../../specs/api/hoondok-api.md#plan-hd-011--ai-낭독-목소리-api-hd-044046), 엔티티는 [`ENT-HD-018`](../../specs/domain/hoondok-entities.md), 운영 절차는 [런북](../../runbooks/hoondok-pwa-rollout.md#ai-낭독-목소리-운영-on-plan-hd-011).
- 표기: 라벨 없는 문장은 코드·테스트로 확인한 사실. `[가정]` 은 검증이 필요한 추론, `[확인 필요]` 는 사용자·외부 결정.

## 1. 사용자 결정 (2026-09-25, 재논의 금지)

| # | 결정 |
|---|---|
| 1 | 목소리 4종, 모두 Google Chirp 3 HD · speakingRate 0.9 — `sulafat`(기본, 차분한 여성) · `aoede`(맑은 여성) · `algieba`(부드러운 남성) · `iapetus`(또렷한 남성) |
| 2 | 범위는 원문 뷰(`/hoondok/words/{volume}`)와 오늘 훈독(`/hoondok/read`) 두 화면 |
| 3 | 생성 방식은 처음 들을 때 단락 mp3 를 만들어 파일로 저장. 월 900,000자 상한, 넘으면 브라우저 음성으로 대체 |
| 4 | UI 는 "1안 조용한 목록" — 듣기 바의 목소리 칩 → 시트(목록 radiogroup·4초 견본·속도 0.8/1.0/1.2), 선택은 기기에 기억 |

## 2. 트랙·진행표

| 트랙 | 소유 파일 | 완료 기준 | 상태 |
|---|---|---|---|
| A API | `apps/api/app/modules/hoondok/tts_*.py` · `models.py`(`TtsUsage`) · alembic `s4d5e6f7a8b9` · `journey_service.chunk_display_text` · `tests/test_hoondok_tts.py` · 계약 재생성 | 캐시 적중·목소리별 분리·동시 1회 합성·월 상한·권리/편성/소유자 404·Google 재시도·오류 코드. `contracts:check` 추가만 | ✅ `627ffb3` · `b7e59ac`(캐시 실패 허용) |
| B 웹 | `apps/web/src/features/hoondok/library/tts/*` · `words-screen.tsx` · `jeongseong/components/effective-reading.tsx` · `_hoondok/library.css` · `public/hoondok/voices/*.mp3` · `src/test/hoondok-voice-reader.test.tsx` | 순차 재생·미리 받기·로딩·재생 중 목소리 변경·꺼짐/상한/비로그인/오류 대체와 안내, 시트 접근성. `hoondok:check` 통과 | ✅ `caacf92` |
| C e2e | `tests/e2e/hoondok-library.spec.ts` | 375px 에서 칩 → 시트 → 선택·속도 → Esc 포커스 복귀 → 요청 `voice=aoede` → 새로고침 뒤 유지 (API 스텁) | ✅ `7f55536` · `make e2e` 99 통과 |
| D 문서·운영 | 이 문서 · 런북 · API/엔티티 명세 · `infra/oracle-vm/docker-compose.yml` · `.env.example` · `docs/TODO.md` · 앱 `AGENTS.md` | docs-links 새 오류 0 | ✅ `0833fbf`(compose) · 이 커밋. `make ci` 통과(pytest 1317 · web Vitest 473) |

## 3. 인수 조건

1. 클라이언트는 텍스트를 보내지 않는다 — 청크 id 또는 말씀 id + 단락 번호뿐이다. 서버가 권리(`scope_full_text`·`scope_jeongseong`)·편성 공개일·소유자를 확인한다.
2. 같은 목소리·같은 본문은 두 번째부터 저장본을 준다(`X-Tts-Cache: hit`, Google 호출 0). 동시 요청도 한 번만 합성한다.
3. 키가 없으면 503 `TTS_DISABLED`, 상한이면 429 `TTS_QUOTA_EXCEEDED`, Google 실패는 502 `TTS_UPSTREAM_FAILED` 이고, 웹은 모두 같은 단락부터 브라우저 음성으로 이어 읽으며 안내 한 줄을 보인다.
4. 목소리 시트: 칩 `aria-haspopup`·`aria-expanded`, radiogroup·체크 하나, 줄을 누르면 즉시 선택 + 4초 견본, Esc·바깥으로 닫고 포커스는 칩으로. 터치 대상 44px 이상.
5. 재생 중 목소리를 바꾸면 현재 단락부터 새 목소리로 읽는다. 속도는 재생 속도(`playbackRate`)라 새로 합성하지 않는다.
6. 테스트는 Google 을 부르지 않는다.

## 4. 한계·[가정]

- [가정] backend 는 uvicorn 단일 워커라 프로세스 락으로 같은 키 합성을 막는다. 워커를 늘리면 파일 락이 필요하다.
- [가정] 상한 직전에 서로 다른 단락 요청이 동시에 오면 1~2건만큼 넘을 수 있다. 상한이 무료 한도(월 100만 자)의 90% 라 허용한다.
- [가정] iOS Safari 의 재생 제스처 제한은 첫 탭에서 무음 WAV 를 재생해 푼다. 실기기에서 확인하지 않았다.
- 오늘 훈독 화면은 단락 강조를 하지 않는다(말씀 카드가 단락 단위로 그려지지 않는다).
- 캐시 파일은 지우지 않는다. 볼륨 용량은 런북의 점검 절차로 본다.

## 5. [확인 필요]

- 운영 TTS 키 발급(GCP `gcp-project-504004`, Text-to-Speech API 한정 키).
- 협회 본문을 Google Cloud 로 보내 합성하는 것에 대한 협회 확인.
- 운영 VM 캐시 디스크 용량 점검 주기, backend 컨테이너 appuser uid 실측.

## 6. 결정 기록

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-09-25 | 키는 쿼리 `?key=` 대신 `X-Goog-Api-Key` 헤더 | 접근 로그·예외 메시지에 키가 남지 않게 |
| 2026-09-25 | 캐시 쓰기 실패는 듣기를 막지 않는다 | 볼륨 권한·디스크 부족이 사용자 오류로 번지지 않게. 사용량은 그대로 세어 상한이 비용을 막는다 |
| 2026-09-25 | 견본은 정적 mp3(5초·40kbps mono) | 시트를 열 때마다 합성·과금하지 않게 |
