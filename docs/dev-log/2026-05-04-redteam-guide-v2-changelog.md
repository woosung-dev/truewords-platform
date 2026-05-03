# ADR — 레드팀 테스트 가이드 v1.3 → v2.0 개정 사유

**작성일**: 2026-05-04  
**작성자**: TrueWords Platform Team  
**상태**: 적용 (`docs/guides/redteam-test-guide-v2.md` 머지)  
**관련 산출물**: `docs/guides/redteam-test-guide-v2.md`, `docs/guides/redteam-test-guide-v2.pdf`, `docs/guides/redteam-assets/v2/`  
**Phase**: MVP Phase 3 — 외부 클라이언트 레드팀 위탁 단계 진입

---

## 1. 배경

v1.3 (2026-04-15)은 내부 레드팀 대상 종합 가이드로, 39 PDF 페이지 / 1153 markdown 줄 분량이었다. 이후 약 3주간 다음 변경이 누적되었다:

- **백엔드 정책 변화**: PR #95 (Gemini Batch 제거), PR #97 (환경 indicator), PR #108 (Cascade cutoff=0.1 결정 ADR), PR #125 (캐시 invalidation 메타데이터)
- **클라이언트 UX 대폭 개편**: PR #133 (피드백 폴리시 토글), PR #134 (답변 UI 모더나이제이션 + 원문보기), PR #135 (메인 청크 좌측 border 제거), PR #136 (FloatingActionBar 전체 숨김)
- **사실 정정 누적**: 코드 심층 탐색 결과 v1.3에 부정확한 기술 기재가 다수 발견됨 (47→31 패턴, "SSE 스트리밍" → 단일 JSON, 민감 인명 필터 패턴 DB 비어있음, 5회 락 미구현)
- **Phase 전환**: 내부 레드팀 → **외부 클라이언트 위탁**으로 단계 이동. 외부 테스터의 재현성·증거 보존 요구 증가.

이상의 변화로 v1.3을 외부 회람용으로 그대로 활용하기 어려워, **v2.0 개정**을 결정.

---

## 2. 변경 결정 4가지 (사용자 합의)

작업 착수 전 다음 4가지를 결정했다 (모두 추천 옵션 채택):

| # | 결정 항목 | 선택 |
|:-:|---|---|
| 1 | 출력 포맷 | Markdown + PDF 동시 생성 |
| 2 | Playwright 활용 방식 | 가이드 내 "11장 자동화 테스트" 섹션 신설 + 실제 production 사이트 캡처 임베드 |
| 3 | 신규 시나리오 범위 | 핵심 3개 (J 캐시 오염, K 임계값 우회, L 멀티턴 jailbreak) |
| 4 | 저장 위치 | `docs/guides/redteam-test-guide-v2.md` |
| 5 | J/K/L production 검증 | 1회성 production 검증 후 실제 답변을 가이드에 인용 |

---

## 3. 핵심 변경 사항

### 3.1 사실 정정 (v1.3 부정확 → v2.0 코드 기반)

| v1.3 표기 | v2.0 정정 | 근거 |
|---|---|---|
| 프롬프트 인젝션 패턴 DB **47종** | **31종** (영 10 + 한 13 + 혼합 8) | `backend/src/safety/input_validator.py:23-55` 정규식 카운트 |
| 답변이 "글자 단위 SSE 스트리밍"으로 출력 | **단일 JSON 응답** + 클라이언트 측 3점 로딩 애니메이션 | `admin/src/features/chat/api.ts` `chatAPI.sendMessage()` = `res.json()` |
| 보안 장치 #6 민감 인명 필터 발동 | 함수만 준비, **`SENSITIVE_PATTERNS = []` 비어있음** — 시스템 프롬프트 + LLM 토큰 제약에 의존 | `backend/src/safety/output_filter.py` |
| 5회 비밀번호 실패 시 락 (추후 추가) | **미구현** — "브루트포스 검증 항목"으로 재분류 | `backend/src/admin/auth.py` 카운터·타이머 부재 확인 |
| 챗봇 6종 | **11종** (전문 7 + 실험/비교용 4) | `GET /chatbots` 운영 응답 |
| 데이터 카테고리 16개, 청크 66,529 | 동일 (기준 시점만 갱신) | `GET /admin/analytics/dashboard-summary` |

### 3.2 UI 갱신 (PR 매핑)

| 섹션 | PR | 변경 내용 |
|---|---|---|
| 4.3 답변 화면 | PR #134 | 마크다운 GFM 지원, 본문 끝 "출처: …" 텍스트 → 인라인 `[N]` 위첨자, ClosingCallout |
| 4.5 원문보기 모달 (신설) | PR #134 | 하단 슬라이드업 sheet, LCS dedup된 merged_text |
| 4.5 메인 청크 강조 | PR #135 | 좌측 border **제거**, 배경+ring만 |
| 4.8 FloatingActionBar (신설) | PR #136 | 새 질문/북마크/공유 **전체 숨김** — 기능 미구현 표시 |
| 5.4 데이터 소스 | PR #97 | 환경 badge + 컬렉션명 + Qdrant 호스트 |
| 5.4 처리 방식 | PR #95 | 배치 API 제거, 즉시 처리 단일 모드 |
| 5.6 피드백 | PR #133 | 긍정/부정 인라인 토글, PieChart 5색 팔레트, SessionDetailModal |

### 3.3 신규 공격 시나리오 3종

| 코드 | 이름 | 심각도 | 핵심 |
|---|---|:-:|---|
| J-1 | Semantic Cache 오염 | HIGH | 유사도 0.85~0.92 변형 질문으로 캐시 히트 유도 |
| K-1 | score_threshold 우회 | MEDIUM | Cascading 폴백 강요 / 임계값 미달 청크 인용 유도 |
| L-1 | 멀티턴 Jailbreak 6턴 | CRITICAL | 5턴 신뢰 누적 후 시스템 프롬프트 무력화 |

총 시나리오: 21 → **24개**. 매트릭스(7.1) 갱신, 8.4 보안 체크리스트에 L-1 추가.

### 3.4 Playwright MCP 자동화 테스트 (11장 신설)

외부 클라이언트 테스터가 MCP 호환 에이전트(Claude Code 등)로 24개 시나리오를 재현 가능한 시퀀스로 실행하고 9장 버그 리포트와 자동 연동하기 위한 가이드. 5단계 골격(navigate → prepare → attack → verify → capture) + 시나리오별 호출 시퀀스 예시 4개(A-1, F-1, L-1, J-1) 포함.

### 3.5 부록 정정/확장

- B 기술 참고 문서: 백엔드/프론트엔드 코드 경로 12개 추가
- C API 엔드포인트: 14개 → **30개** (analytics 세부, audit-logs, data-source-categories, sessions 추가)

---

## 4. 자산 재사용 정책

- 기존 `docs/guides/redteam-assets/*.png` 35장 중 **22장 재사용** (변동 없음 화면 — 03 login, 04 dashboard, 05 chatbots-list, 06/15/16 chatbot-edit, 09 analytics, 11 audit-logs, 12 settings)
- **신규 캡처 12장** → `docs/guides/redteam-assets/v2/` (PR #97/#133/#134/#135/#136 영향 화면)
- `annotate_screenshots.py` (PIL + AppleSDGothicNeo) 동일 스크립트 재사용

## 5. PDF 빌드

- 사용 도구: pandoc 3.9.0.2 (이미 설치)
- 한글 폰트: AppleSDGothicNeo
- 명령(임시): `pandoc redteam-test-guide-v2.md -o redteam-test-guide-v2.pdf --pdf-engine=xelatex -V mainfont="AppleSDGothicNeo" --toc --toc-depth=3 -V geometry:margin=2cm`
- 산출 위치: `docs/guides/redteam-test-guide-v2.pdf` (gitignore 포함 여부는 별도 결정 — 기존 v1.3 정책 따름)

## 6. 회람 절차

1. PR로 v2.0 본문 + 신규 자산 + 본 ADR 함께 머지
2. PDF 빌드 산출물을 외부 클라이언트에 직접 전달 (Slack DM 또는 비공개 채널)
3. 외부 테스터 1차 라운드 결과를 9장 버그 리포트 + 11.6 점수표 형식으로 회수
4. CRITICAL 결과는 즉시 backlog 등록, MEDIUM은 다음 스프린트 검토

## 7. 향후 v2.1 후보 (현재 가이드에 미반영)

- M. 피드백 시스템 위조 (대량 부정 피드백 등록 시 분석 왜곡)
- N. SSE 스트리밍 활성화 시 응답 중단 일관성 검증 (현재 단일 JSON이라 미해당)
- O. CSRF 헤더 우회 시도 / 클라이언트 사이드 라우트 보호 우회
- P. 관리자 입력 필드 XSS 대규모 자동화 (현재 8.4에 단일 항목만)
- 민감 인명 필터 패턴 DB 채워질 시 7.E 기대 방어 절 재갱신
- 백엔드 SSE 클라이언트 활성화 시 4.3 응답 흐름 재기재
