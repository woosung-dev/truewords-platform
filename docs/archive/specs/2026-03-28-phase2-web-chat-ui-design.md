# Phase 2 설계 스펙: Flutter Chat UI + SSE 스트리밍

**작성일:** 2026-03-28
**범위:** FastAPI SSE 엔드포인트 + Flutter 채팅 UI
**상태:** DRAFT

---

## 1. 목표와 성공 기준

### 목표

Phase 1에서 구축한 RAG 파이프라인(POST /chat)을 **실시간 SSE 스트리밍 Flutter 채팅 앱**으로 확장한다.
사용자가 Flutter 앱에서 질문을 입력하면 SSE로 답변이 토큰 단위로 스트리밍되고, 출처(말씀 권명)가 함께 표시된다.

### 성공 기준

| # | 기준 | 측정 방법 |
|---|------|----------|
| 1 | POST /chat/stream SSE 엔드포인트 동작 | curl로 SSE 이벤트 수신 확인 |
| 2 | 첫 토큰 응답 < 2초 (TTFB) | Flutter DevTools 네트워크 측정 |
| 3 | Flutter 채팅 UI에서 타이핑 효과로 답변 렌더링 | 수동 QA |
| 4 | 답변 완료 후 출처 카드 표시 (volume, text, score) | 수동 QA |
| 5 | 에러/타임아웃 시 사용자에게 재시도 버튼 표시 | 네트워크 차단 테스트 |
| 6 | Docker Compose로 backend 원커맨드 실행 + Flutter 앱 별도 실행 | `docker compose up` + `flutter run` 확인 |
| 7 | 기존 POST /chat 엔드포인트 회귀 없음 | 기존 24개 pytest 통과 |
| 8 | SSE 연결 끊김 감지 + "연결이 끊어졌습니다" 표시 | 강제 끊김 테스트 |

---

## 2. 설계 결정 + 트레이드오프

### 2.1 SSE 구현: Dio stream vs dart:io HttpClient vs web_socket_channel

**결정: Dio stream (ResponseType.stream)**

| 항목 | Dio stream | dart:io HttpClient | web_socket_channel |
|------|-----------|--------------------|--------------------|
| HTTP POST 지원 | O (네이티브) | O (수동 구현) | X (WebSocket 전용) |
| SSE 파싱 편의 | stream transform 체인 | 저수준 바이트 처리 | 프로토콜 자체가 다름 |
| 인터셉터/에러 | Dio 인터셉터 재사용 | 직접 구현 | 별도 구현 |
| 타임아웃/재시도 | Dio 옵션 내장 | 직접 구현 | 직접 구현 |
| 프로젝트 규칙 | 확정 스택 (Dio) | 미채택 | 부적합 |

**근거:**
- 프로젝트 확정 스택에서 Dio를 네트워킹 라이브러리로 지정
- AI 답변 스트리밍은 서버→클라이언트 단방향이므로 SSE가 정확히 맞는 패턴
- `ResponseType.stream`으로 바이트 스트림을 받아 utf8 디코딩 + LineSplitter로 SSE 파싱 가능
- Dio 인터셉터로 인증 토큰, 로깅 등 공통 로직 재사용 가능

**트레이드오프:**
- Dio는 SSE 전용 라이브러리가 아니므로 SSE 파싱 유틸을 직접 구현해야 함
- 향후 커뮤니티 기능(G-02)에서는 WebSocket 필요 → 그때 web_socket_channel 별도 추가

### 2.2 상태 관리: Riverpod AsyncNotifier 채팅 스트리밍 상태 설계

**결정: Riverpod AsyncNotifier (확정)**

상태 모델:

```
ChatState (freezed)
├── messages: List<ChatMessage>      # 전체 대화 목록
├── isStreaming: bool                # 현재 스트리밍 중 여부
└── streamingMessageId: String?      # 스트리밍 중인 메시지 ID (null = 유휴)
```

**Notifier 설계:**

```
ChatNotifier extends AsyncNotifier<ChatState>
├── build()              → 초기 빈 상태 반환
├── sendMessage(query)   → 사용자 메시지 추가 + SSE 스트리밍 시작
├── cancelStream()       → Dio CancelToken으로 스트리밍 중단
├── retryLastMessage()   → 마지막 에러 메시지 제거 + 재전송
└── clearMessages()      → 대화 초기화
```

**규칙 준수:**
- `build()`에서 `ref.watch()` → ChatRepository 주입
- 이벤트 메서드에서 `ref.read()` → Repository 호출
- `AsyncValue.when()`으로 UI에서 로딩/에러/데이터 처리
- StateNotifier 사용 금지 → AsyncNotifier만 사용

**React Query 해당 없음 (Riverpod이 서버 상태도 관리):**
- SSE 스트리밍은 일반 request-response가 아님 → 캐싱 불필요
- 대화 내역 서버 저장 없음 (Phase 4에서 추가)

### 2.3 UI 컴포넌트 설계

디자인 전략 문서(17-design-strategy.md)를 기반으로 한 컴포넌트:

| 컴포넌트 | 역할 | 위치 |
|----------|------|------|
| ChatScreen | 채팅 전체 화면 (ConsumerWidget) | presentation/screens/ |
| MessageBubble | 사용자/AI 메시지 버블 | presentation/widgets/ |
| SourceCard | 출처 정보 카드 (접이식) | presentation/widgets/ |
| ChatInputBar | 입력 필드 + 전송/중지 버튼 | presentation/widgets/ |
| StreamingIndicator | 스트리밍 중 점 3개 애니메이션 | presentation/widgets/ |
| EmptyStateWidget | 대화 없을 때 안내 화면 | presentation/widgets/ |
| ErrorRetryWidget | 에러 메시지 + 재시도 버튼 | presentation/widgets/ |

**디자인 시스템 (17-design-strategy.md 기반):**
- Primary: 따뜻한 남색 (#2C3E6B)
- Background: 따뜻한 아이보리 (#F8F5F0)
- Surface: 화이트 (#FFFFFF)
- User 버블: Primary (#2C3E6B), 흰색 텍스트
- AI 버블: Surface (#FFFFFF), 차콜 텍스트 (#2D2D2D)
- 에러 버블: 연한 빨강 배경 + 빨강 텍스트

### 2.4 프로젝트 디렉토리

**결정: `app/` (프로젝트 루트에 Flutter 프로젝트)**

| 옵션 | 장점 | 단점 |
|------|------|------|
| `app/` | 간결, "앱"이라는 의미 명확 | 일반적이라 모호할 수 있음 |
| `mobile/` | 모바일 앱임을 명시 | Flutter는 웹/데스크톱도 지원 |
| `flutter/` | 기술 스택 명시 | 프레임워크 변경 시 디렉토리명 불일치 |

**근거:**
- TrueWords는 모바일 우선 앱이므로 `app/`이 직관적
- 백엔드는 `backend/`, 앱은 `app/` — 대칭적 명명
- Flutter가 다중 플랫폼을 지원하므로 `mobile/`보다 `app/`이 포괄적

### 2.5 백엔드 SSE 엔드포인트

**결정: FastAPI StreamingResponse + 구조화된 SSE 이벤트**

SSE 이벤트 스키마 (프로젝트 인터페이스 계약 준수):

```
POST /chat/stream
Content-Type: text/event-stream

# 1. 검색 완료 시 출처 전송
data: {"sources": [{"volume": "축복행정 규정집", "text": "...", "score": 0.85}]}

# 2. LLM 토큰 스트리밍 (반복)
data: {"text": "참부모님의"}

data: {"text": " 말씀에 따르면"}

# 3. 완료 신호
data: {}

# (에러 발생 시)
data: {"message": "Gemini API 응답 시간 초과"}
```

| 이벤트 유형 | 판별 기준 | 설명 |
|------------|----------|------|
| sources | `data`에 `sources` 키 존재 | 검색 출처 목록 |
| text_delta | `data`에 `text` 키 존재 | 답변 토큰 조각 |
| done | `data`가 `{}` (빈 객체) | 스트리밍 종료 신호 |
| error | `data`에 `message` 키 존재 | 에러 발생 |

**설계 근거:**
- `sources`를 답변 전에 보내면 Flutter에서 출처를 먼저 렌더링 가능
- `done` (빈 객체)으로 명시적 종료 → Flutter에서 스트리밍 상태 해제
- `error`로 서버측 에러를 구조화하여 전달
- 이벤트 유형을 SSE event 필드 대신 data JSON 구조로 판별 → 단순한 파싱

### 연결 끊김 감지

`done` 이벤트(빈 객체) 없이 스트림이 종료되는 경우(네트워크 끊김, 서버 크래시 등) ChatRepository가 이를 감지하여 에러로 처리해야 한다.

| 상황 | 감지 방법 | 처리 방식 |
|------|----------|----------|
| 정상 종료 | `done` (빈 객체) 수신 후 스트림 완료 | 스트리밍 상태 해제 |
| 비정상 종료 | 스트림 종료 시 `done` 미수신 | "연결이 끊어졌습니다" 오류 + 재시도 버튼 |
| 네트워크 오류 | Dio 예외 발생 | catch 블록에서 에러 처리 |

---

## 3. 범위 제한 (NOT in scope)

Phase 2에서 명시적으로 **하지 않는 것**:

| # | 항목 | 이유 | 예정 Phase |
|---|------|------|-----------|
| 1 | 사용자 인증/로그인 | 인증 시스템 미구축 상태 | Phase 3+ |
| 2 | 대화 내역 저장 (DB) | PostgreSQL 미구축 상태 | Phase 3+ |
| 3 | 일일 묵상 카드 (M-02) | 별도 기능, 백엔드 API 미구축 | Phase 3+ |
| 4 | Streak 트래커 (M-03) | 별도 기능, DB 필요 | Phase 3+ |
| 5 | 맞춤 기도문 (M-04) | 별도 기능 | Phase 3+ |
| 6 | 성경 뷰어 (M-05) | 별도 기능, 데이터 미구축 | Phase 3+ |
| 7 | Semantic Cache | 아키텍처 고도화 항목 | 별도 |
| 8 | Query Rewriting | 별도 고도화 항목 | 별도 |
| 9 | 다중 챗봇 버전 선택 UI | 현재 단일 컬렉션만 적재 | Phase 3+ |
| 10 | 다크 모드 | MVP 이후 | Growth |
| 11 | 오프라인 지원 | MVP 이후 | Growth |
| 12 | 국제화 (i18n) | 한국어 전용 | Scale |
| 13 | 커뮤니티 기능 (G-02) | Growth Phase | Growth |
| 14 | 오디오 묵상 (G-01) | Growth Phase | Growth |
| 15 | 하단 탭 네비게이션 (5탭) | Phase 2는 채팅 단일 화면 | Phase 3+ |
| 16 | 피드백 버튼 (좋아요/싫어요) | MVP 이후 | Phase 3+ |

**Phase 2 범위 = 백엔드 SSE + Flutter 채팅 단일 화면**

---

## 4. 의존성 분석

### 4.1 Phase 1 코드 — 수정이 필요한 것

| 파일 | 수정 내용 | 이유 |
|------|----------|------|
| `backend/src/chat/generator.py` | `generate_answer_stream()` 함수 추가 | Gemini SDK의 스트리밍 API 호출 필요 |
| `backend/api/routes.py` | `POST /chat/stream` 엔드포인트 추가 | SSE 라우트 신규 |
| `backend/main.py` | CORS 미들웨어 추가 | Flutter 앱 → 백엔드 크로스오리진 요청 (웹 빌드 시) |

### 4.2 Phase 1 코드 — 수정하지 않는 것

| 파일 | 이유 |
|------|------|
| `src/search/hybrid.py` | 검색 로직 변경 없음 (그대로 사용) |
| `src/pipeline/*` | 인제스트 파이프라인 변경 없음 |
| `src/qdrant_client.py` | Qdrant 클라이언트 변경 없음 |
| `src/chat/prompt.py` | 프롬프트 변경 없음 |
| `src/config.py` | 환경변수 변경 없음 |

### 4.3 Flutter 신규 생성

| 파일/디렉토리 | 설명 |
|-------------|------|
| `app/` | Flutter 프로젝트 전체 |
| `app/lib/features/chat/` | 채팅 Feature (presentation, data, models) |
| `app/lib/core/` | 공통 인프라 (Dio, go_router, 에러 타입) |
| `app/test/` | Widget 테스트, Repository 목 테스트, SSE 파싱 테스트 |

### 4.4 Flutter 패키지 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| flutter_riverpod | ^2.5 | 상태 관리 |
| riverpod_annotation | ^2.3 | @riverpod 코드 생성 |
| riverpod_generator | ^2.4 | 코드 생성기 |
| go_router | ^14.0 | 라우팅 |
| dio | ^5.4 | HTTP 클라이언트 + SSE 스트림 |
| freezed_annotation | ^2.4 | 불변 데이터 모델 어노테이션 |
| freezed | ^2.5 | 코드 생성기 |
| json_annotation | ^4.9 | JSON 직렬화 어노테이션 |
| json_serializable | ^6.8 | JSON 코드 생성기 |
| build_runner | ^2.4 | 코드 생성 실행기 |
| uuid | ^4.3 | 메시지 ID 생성 |
| google_fonts | ^6.2 | Pretendard/Noto Serif KR 폰트 |

---

## 5. 리스크 + 완화 전략

### 리스크 1: Gemini SDK 스트리밍 API 호환성

- **위험도:** 중
- **설명:** `google-genai` 1.68.0에서 스트리밍 응답 메서드 확인 필요
- **완화:** `_client.models.generate_content_stream()` 메서드 사용. SDK 문서에서 스트리밍 지원 확인됨 (google-genai >= 1.0). 각 chunk의 `.text` 속성으로 토큰 추출.

### 리스크 2: SSE 연결 타임아웃

- **위험도:** 중
- **설명:** Gemini API 응답이 30초 이상 걸리면 중간 프록시가 연결을 끊을 수 있음
- **완화:**
  - 백엔드에서 5초마다 keepalive 코멘트 전송 (`: keepalive\n\n`)
  - Dio에서 receiveTimeout을 충분히 크게 설정 (120초)
  - Flutter UI에서 30초 초과 시 사용자에게 안내 표시

### 리스크 3: Dio SSE 파싱 안정성

- **위험도:** 중
- **설명:** SSE 데이터가 바이트 청크 경계에서 잘릴 수 있음
- **완화:**
  - `LineSplitter`를 사용하여 완전한 라인 단위로만 처리
  - `data: ` 접두사가 있는 라인만 필터링
  - 불완전한 JSON은 무시하고 다음 라인 처리

### 리스크 4: Flutter 코드 생성 (freezed/riverpod_generator)

- **위험도:** 낮
- **설명:** `build_runner`가 모델/프로바이더 코드를 생성하지 못하면 컴파일 에러
- **완화:**
  - `dart run build_runner build --delete-conflicting-outputs` 실행
  - `.g.dart`, `.freezed.dart` 파일을 .gitignore에 추가하지 않음 (CI에서 재생성)

### 리스크 5: CORS 설정 (Flutter 웹 빌드 시)

- **위험도:** 낮
- **설명:** Flutter 웹 디버그 모드에서는 CORS 필요, 모바일 네이티브에서는 불필요
- **완화:** FastAPI CORSMiddleware에 `http://localhost:*` 패턴 등록. 프로덕션에서는 도메인 명시.

### 리스크 6: 스트리밍 메모리 관리

- **위험도:** 낮
- **설명:** 긴 대화에서 메시지 목록이 계속 증가하면 메모리 사용량 증가
- **완화:**
  - ListView.builder로 가상화 렌더링 (화면 밖 위젯 자동 해제)
  - Phase 2에서는 메모리 이슈 발생 전에 사용자가 앱을 재시작할 것으로 예상
  - 향후 대화 내역 DB 저장 시 메모리 내 보관량 제한 추가

### 리스크 7: Riverpod Notifier에서 스트림 dispose 처리

- **위험도:** 중
- **설명:** 사용자가 화면을 벗어나거나 앱을 종료하면 진행 중인 SSE 스트림을 정리해야 함
- **완화:**
  - Dio CancelToken을 Notifier에서 관리
  - Notifier의 `ref.onDispose()`에서 CancelToken.cancel() 호출
  - go_router의 화면 전환 시 자동 dispose 보장
