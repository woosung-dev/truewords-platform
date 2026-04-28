# ADR-46 사용자 입력 처리 개편 통합 PR

> `feat/ui-ux-foundation` → `main` (32 commits, +4,618 / -294, 53 files)

## Summary

ADR-46 (한국·글로벌 종교 AI 챗봇 12종 벤치마크) 의 30개 액션 중 **PoC 단계 가치가 명확한 11건**을 통합. cross-review 2 라운드 + PoC trim 을 거쳐 안전·성능·운영 부담이 적은 단일 PR 로 정리.

## 핵심 변경

### 디자인 시스템 (W1)
- `globals.css`: warm paper bg / scholarly navy / brass accent / highlight / pastoral / 모션·그림자 토큰 (Light/Dark)
- `Noto Serif KR` (reading) + `Cormorant Garamond` (display) 폰트 추가
- `components/truewords/`: ChatButton / QuestionInput / CitationCard / PersonaSheet / FloatingActionBar / FollowupPills / FeedbackButtons / ClosingTemplate / StreamingText / SourceOriginalModal (10 컴포넌트)
- `/design-system` 라이브 데모 페이지

### 입력 화면 개편
- **P0-C**: QuestionInput 두 줄 placeholder 가이드 + 1000자 카운터
- **P0-D**: 면책 4문장 footer + 모델 버전 표시
- **P0-E**: 답변 모드 페르소나 5종 sheet (표준/신학자/목회상담/초신자/어린이)
- **P1-G**: 강조점 5종 sheet (전체/원리/후천기·섭리사/가정·축복/청년·실천)

### 답변 파이프라인
- **P0-A**: SuggestedFollowupsStage — 본 답변 후 LLM 호출로 다음 질문 3개 추천 (0.5s timeout, pastoral 모드 자동 disable)
- **P0-E 모드 라우팅**: `resolve_answer_mode()` 가 `(mode, overridden, crisis_trigger)` 3-tuple 반환. IntentClassifier 결과 + 사용자 명시 모드 + 위기 키워드 우선순위로 결정
- **P1-J**: ClosingTemplateStage — 기도문/결의문 마무리 (pastoral 모드 자동 disable)
- **P0-G**: FloatingActionBar — 답변 페이지 새질문/북마크/공유 (navigator.share + clipboard fallback)

### 보안 / 안전 (cross-review 2 라운드 합의)
- **B1** chunks endpoint chatbot ACL — `chatbot_id` 필수 + source filter 검증, 비공개 챗봇 chunk leak 차단
- **B2** reactions endpoint auth — HttpOnly cookie 서버 발급 + IP rate limit + atomic toggle
- **B6** popular endpoint k-anonymity — 본 PR 에서 P1-C 제거로 무관해짐
- **B7** notes endpoint ownership — 본 PR 에서 P1-H 제거로 무관해짐
- **B4** pastoral 답변 hotline 무조건 강제 append (자살예방법 의무)
- **B5** 사용자 명시 페르소나 위기 신호 시 강제 override + UI 노티 (`persona_overridden`)
- **C3** 위기 키워드 30+개 (DIRECT 9 + EMOTIONAL 13) + NFC 정규화

### 측정 인프라
- **M1** session_messages 4 컬럼: `requested_answer_mode` / `resolved_answer_mode` / `persona_overridden` / `crisis_trigger`
- **M2** FK `ondelete=CASCADE`: chat_message_reactions (GDPR / 세션 cleanup 시 orphan 차단)
- **M3** NFC unicode normalization: macOS/iOS NSString clipboard NFD 우회 방어 (Flutter Phase 4 prerequisite)

### 답변 평가 (P1-A)
- `chat_message_reactions` 테이블 + 토글 endpoint (👍/👎/💾)
- HttpOnly cookie 기반 익명 사용자 추적
- 향후 운영자 검수 데이터의 baseline

### 인용 원문 모달 (P0-B)
- `GET /api/sources/chunks/{id}?chatbot_id=...` (ACL 적용)
- `SourceOriginalModal` 컴포넌트 (highlight snippet 노란 표시)

### 페이지 / 라우트 신규
- `/about` — 운영 투명성 (4 운영 원칙 / 모델 / 기술 footer)
- `/design-system` — 컴포넌트 라이브 데모

## PoC trim — 의도적 제거

운영 인프라 부재로 영영 dead 가 될 위험이 있는 7묶음 제거. 운영 트리거 충족 시점에 git history 에서 복구.

| 제거 | 트리거 |
|:---|:---|
| P1-D 이미지 SNS 공유 + P2-E UTM | 카카오톡/SNS 공유 SDK + analytics 인프라 |
| P1-K AnswerReview 검수 사이클 | 신학 자문 4명 운영 인력 + SOP |
| P1-H ChatMessageNote 인용 노트 | 사용자 노트 시나리오 본격 |
| P1-C 인기 질문 동적 노출 | 사용자 1만+ 도달 (k=3 의미 있는 데이터 양) |
| P1-B citation 4중 메타 | Qdrant payload 인덱싱 파이프라인 보강 |
| P2-D 공개/비공개 토글 | ChatbotConfig.visibility 컬럼 정책 |
| P2-K follow-up 부분 블러 + 카카오 로그인 | 카카오 로그인 인프라 |

## 검증

- 백엔드: **87 tests passed** (pytest)
- 프론트: **tsc 0**, **next build 0**, **vitest 43 tests passed**
- alembic single head: `m1a02b03c04d`

## 외부 검증 — 3-Reviewer Cross-Review (2 rounds)

### Round 1 (W1+W2 통합 시점)
- Opus 4.7: 6.0/10, Request Changes (Block 직전)
- Sonnet 4.6: Build/Test/Type Safety 점수 + Recommended
- Codex 외부시각: BLOCK 2건 (chunks ACL / reactions auth) + Mitigate 다수

→ 처리: B1/B2/B3 + C1/C2 (5 fixes)

### Round 2 (W3 + B4/B5/C3 추가 시점)
- Opus 4.7: 7.5/10, Approve with W4-blocking follow-ups
- Sonnet 4.6: Approve with Recommended (Critical 없음)
- Codex 외부시각: BLOCK 2건 (popular k-anonymity / notes ownership) + Mitigate 다수

→ 처리: B6/B7 + M1/M2/M3/M4 (6-fix bundle)

### PoC trim
Round 2 의 W4-blocking 권고 (운영 인력 / 사용자 onboarding 트리거) 를 W4 미루지 않고 PoC 단계에 영영 dead 가 될 부분 정리로 대체. 약 -3,300줄.

## Test plan

- [ ] 로컬 dev 서버 띄워 `/design-system` 둘러보기 — 컴포넌트 동작 / 다크모드
- [ ] `/about` 페이지 시각 — 4 운영 원칙 / 모델 footer
- [ ] `/(chat)` — 페르소나 sheet 5종 / 강조점 sheet 5종 / floating bar / 면책 footer
- [ ] 위기 시나리오 입력 — "죽고 싶어요" / "오늘 너무 힘들어요" → pastoral 자동 + 1393 footer
- [ ] 답변 평가 (👍/👎/💾) — cookie 기반 토글
- [ ] 인용 카드 "원문 보기" → SourceOriginalModal
- [ ] alembic upgrade head — 운영 DB 와 동일한 PostgreSQL 환경에서 마이그레이션 적용 확인
- [ ] E2E 12 tests 회귀 (Playwright)
- [ ] 백엔드 274 + 신규 87 = 361 tests 통과
- [ ] Vercel preview 배포 + 시각 확인

## 후속 PR (운영 트리거 도달 시)

| 트리거 | 후속 작업 |
|:---|:---|
| 신학 자문 4명 확보 | P1-K AnswerReview 재추가 + SOP docs |
| 사용자 1만+ 도달 | P1-C 인기 질문 + visibility 정책 |
| 카카오 로그인 인프라 | P1-D 이미지 공유 + P2-K 블러 + 로그인 CTA |
| Flutter Phase 4 시작 | P1-H 노트 + 답변 화면 본격 통합 |
| 운영 데이터 14일 수집 후 | crisis IntentClassifier LLM 승격 (C3 cost-floor 대체) |

## 관련 문서

- `docs/dev-log/45-input-handling-benchmark.md` — ADR-45 1차 벤치마크
- `docs/dev-log/46-input-handling-live-findings.md` — ADR-46 실측 + 30 액션 정의
- `~/.claude/plans/ai-ai-radiant-grove.md` — UI/UX 풀 디테일 + worktree 전략

🤖 Generated with [Claude Code](https://claude.com/claude-code)
