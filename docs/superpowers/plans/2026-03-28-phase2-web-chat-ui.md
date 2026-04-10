# Phase 2 구현 계획: Flutter Chat UI + SSE 스트리밍

**작성일:** 2026-03-28
**스펙 참조:** `docs/superpowers/specs/2026-03-28-phase2-web-chat-ui-design.md`
**상태:** APPROVED WITH CHANGES

---

## Goal

Phase 1 RAG 파이프라인 위에 SSE 스트리밍 엔드포인트(POST /chat/stream)와 Flutter 채팅 앱을 구축하여, 모바일/웹에서 실시간 토큰 스트리밍으로 말씀 AI 답변을 받을 수 있게 한다.

## Architecture

```
┌──────────────────────────┐     SSE (POST /chat/stream)     ┌─────────────────────┐
│   Flutter App (app/)     │ ◄────────────────────────────── │   FastAPI Backend   │
│   Riverpod + Dio         │ ──────── JSON body ───────────► │                     │
│                          │                                  │  hybrid_search()    │
│  ChatScreen              │     data: {sources: [...]}       │  generate_stream()  │
│   ├─ MessageBubble       │     data: {text: "..."}  (반복)  │                     │
│   ├─ SourceCard          │     data: {}             (완료)  │  Qdrant (Docker)    │
│   ├─ ChatInputBar        │     data: {message: "..."} (에러)│  Gemini 2.5 Flash   │
│   └─ StreamingIndicator  │                                  │                     │
└──────────────────────────┘                                  └─────────────────────┘

데이터 흐름:
  Dio stream → ChatRepository (SSE 파싱) → ChatNotifier (상태 갱신) → ConsumerWidget (UI 렌더링)
```

## Tech Stack

| 영역 | 기술 | 버전 |
|------|------|------|
| Backend | FastAPI + uvicorn | 0.115+ |
| LLM | google-genai (Gemini 2.5 Flash) | 1.68.0+ |
| Vector DB | Qdrant | latest (Docker) |
| App Framework | Flutter (Dart) | 3.x / Dart 3.x |
| State | Riverpod (AsyncNotifier + Generator) | ^2.5 |
| Routing | go_router | ^14.0 |
| Networking | Dio (SSE stream) | ^5.4 |
| Data Model | freezed + json_serializable | ^2.5 / ^6.8 |
| Container | Docker Compose (backend only) | 3.x |

---

## 파일 구조 맵

### 수정 (Modify)

| 파일 | 변경 내용 |
|------|----------|
| `backend/src/chat/generator.py` | `generate_answer_stream()` 스트리밍 제너레이터 추가 |
| `backend/api/routes.py` | `POST /chat/stream` SSE 엔드포인트 추가 |
| `backend/main.py` | CORS 미들웨어 추가 |

### 생성 (Create)

| 파일 | 설명 |
|------|------|
| `backend/tests/test_stream.py` | SSE 스트리밍 테스트 |
| `app/` | Flutter 프로젝트 루트 |
| `app/lib/main.dart` | 앱 진입점 (ProviderScope + MaterialApp.router) |
| `app/lib/core/network/dio_client.dart` | Dio 싱글톤 + 인터셉터 |
| `app/lib/core/network/sse_parser.dart` | SSE 라인 파싱 유틸 |
| `app/lib/core/router/app_router.dart` | go_router 라우트 선언 |
| `app/lib/core/error/app_error.dart` | 전역 에러 타입 (freezed) |
| `app/lib/core/theme/app_theme.dart` | 디자인 시스템 테마 |
| `app/lib/features/chat/data/models/chat_message.dart` | ChatMessage (freezed) |
| `app/lib/features/chat/data/models/source.dart` | Source (freezed) |
| `app/lib/features/chat/data/models/chat_event.dart` | ChatEvent (sealed class) |
| `app/lib/features/chat/data/repositories/chat_repository.dart` | interface + impl |
| `app/lib/features/chat/presentation/providers/chat_notifier.dart` | AsyncNotifier |
| `app/lib/features/chat/presentation/screens/chat_screen.dart` | ConsumerWidget |
| `app/lib/features/chat/presentation/widgets/message_bubble.dart` | 메시지 버블 |
| `app/lib/features/chat/presentation/widgets/source_card.dart` | 출처 카드 |
| `app/lib/features/chat/presentation/widgets/chat_input_bar.dart` | 입력 + 전송 |
| `app/lib/features/chat/presentation/widgets/streaming_indicator.dart` | 스트리밍 표시 |
| `app/lib/features/chat/presentation/widgets/empty_state_widget.dart` | 빈 상태 안내 |
| `app/test/features/chat/data/sse_parser_test.dart` | SSE 파싱 단위 테스트 |
| `app/test/features/chat/data/chat_repository_test.dart` | Repository 목 테스트 |
| `app/test/features/chat/presentation/widgets/message_bubble_test.dart` | Widget 테스트 |
| `app/test/features/chat/presentation/widgets/source_card_test.dart` | Widget 테스트 |
| `app/test/features/chat/presentation/widgets/chat_input_bar_test.dart` | Widget 테스트 |

---

## Task 1: 백엔드 SSE 스트리밍 엔드포인트

**Files:** `backend/src/chat/generator.py`, `backend/api/routes.py`, `backend/main.py`

### Step 1.1: Gemini 스트리밍 제너레이터 함수 작성

- [ ] `backend/src/chat/generator.py`에 `generate_answer_stream()` 추가
- [ ] google-genai SDK의 `models.generate_content_stream()` 사용
- [ ] `SearchResult` 목록을 받아 프롬프트 구성 후 토큰 단위 yield

```python
# backend/src/chat/generator.py 에 추가할 함수
from collections.abc import Generator


def generate_answer_stream(
    query: str, results: list[SearchResult]
) -> Generator[str, None, None]:
    """Gemini 스트리밍 응답을 토큰 단위로 yield한다."""
    prompt = build_context_prompt(query, results)
    response = _client.models.generate_content_stream(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
        ),
    )
    for chunk in response:
        if chunk.text:
            yield chunk.text
```

**실행 명령어:**

```bash
cd backend && uv run python -c "from src.chat.generator import generate_answer_stream; print('import OK')"
```

**Expected:** `import OK` (함수 import 성공)

### Step 1.2: SSE 엔드포인트 구현

- [ ] `backend/api/routes.py`에 `POST /chat/stream` 추가
- [ ] 인터페이스 계약: sources → text_delta → done (또는 error)
- [ ] 검색 결과(sources)를 먼저 전송 → 토큰 스트리밍 → done

```python
# backend/api/routes.py 에 추가
import json
from fastapi.responses import StreamingResponse
from src.chat.generator import generate_answer_stream


@router.post("/chat/stream")
def chat_stream(request: ChatRequest):
    def event_generator():
        try:
            client = get_client()
            results = hybrid_search(client, request.query, top_k=10)

            # sources 이벤트: {"sources": [...]}
            sources_data = {
                "sources": [
                    {"volume": r.volume, "text": r.text, "score": r.score}
                    for r in results[:3]
                ]
            }
            yield f"data: {json.dumps(sources_data, ensure_ascii=False)}\n\n"

            # text_delta 이벤트: {"text": "..."}
            for token in generate_answer_stream(request.query, results):
                yield f"data: {json.dumps({'text': token}, ensure_ascii=False)}\n\n"

            # done 이벤트: {}
            yield "data: {}\n\n"

        except Exception as e:
            # error 이벤트: {"message": "..."}
            error_msg = json.dumps({"message": str(e)}, ensure_ascii=False)
            yield f"data: {error_msg}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

### Step 1.3: CORS 미들웨어 추가

- [ ] `backend/main.py`에 `CORSMiddleware` 추가

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router

app = FastAPI(title="TrueWords RAG PoC", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발 단계: 모든 오리진 허용, 프로덕션에서 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

### Step 1.4: SSE 스트리밍 테스트 작성

- [ ] `backend/tests/test_stream.py` 생성
- [ ] 정상 스트리밍 테스트 (mocked Gemini + Qdrant)
- [ ] 에러 핸들링 테스트
- [ ] 빈 검색 결과 테스트
- [ ] LLM 생성 실패 테스트

```python
# backend/tests/test_stream.py
import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def parse_sse_data_lines(response_text: str) -> list[dict]:
    """SSE 응답에서 data: 라인만 파싱하여 JSON 리스트로 변환한다."""
    events = []
    for line in response_text.strip().split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            data_str = line[6:]
            events.append(json.loads(data_str))
    return events


@patch("api.routes.hybrid_search")
@patch("api.routes.generate_answer_stream")
def test_chat_stream_success(mock_stream, mock_search):
    """정상 SSE 스트리밍: sources → text_delta(들) → done 순서로 이벤트가 전송된다."""
    mock_result = MagicMock()
    mock_result.volume = "축복행정 규정집"
    mock_result.text = "테스트 말씀 본문"
    mock_result.score = 0.85
    mock_search.return_value = [mock_result]
    mock_stream.return_value = iter(["참부모님의 ", "말씀입니다."])

    response = client.post(
        "/chat/stream",
        json={"query": "축복이란 무엇인가요?"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = parse_sse_data_lines(response.text)

    # 첫 번째: sources
    assert "sources" in events[0]
    assert len(events[0]["sources"]) == 1
    assert events[0]["sources"][0]["volume"] == "축복행정 규정집"

    # 중간: text_delta
    text_events = [e for e in events if "text" in e]
    assert len(text_events) == 2
    assert text_events[0]["text"] == "참부모님의 "
    assert text_events[1]["text"] == "말씀입니다."

    # 마지막: done (빈 객체)
    assert events[-1] == {}


@patch("api.routes.hybrid_search")
def test_chat_stream_search_error(mock_search):
    """검색 실패 시 error 이벤트가 전송된다."""
    mock_search.side_effect = Exception("Qdrant 연결 실패")

    response = client.post(
        "/chat/stream",
        json={"query": "테스트 질문"},
    )

    assert response.status_code == 200
    events = parse_sse_data_lines(response.text)
    error_events = [e for e in events if "message" in e]
    assert len(error_events) == 1
    assert "Qdrant 연결 실패" in error_events[0]["message"]


@patch("api.routes.hybrid_search")
@patch("api.routes.generate_answer_stream")
def test_chat_stream_empty_results(mock_stream, mock_search):
    """검색 결과가 없어도 스트리밍이 정상 동작한다."""
    mock_search.return_value = []
    mock_stream.return_value = iter(["관련 말씀을 찾지 못했습니다."])

    response = client.post(
        "/chat/stream",
        json={"query": "존재하지 않는 내용"},
    )

    assert response.status_code == 200
    events = parse_sse_data_lines(response.text)
    assert events[0] == {"sources": []}
    assert events[-1] == {}


@patch("api.routes.hybrid_search")
@patch("api.routes.generate_answer_stream")
def test_chat_stream_generation_error(mock_stream, mock_search):
    """LLM 생성 실패 시 sources 전송 후 error 이벤트가 전송된다."""
    mock_result = MagicMock()
    mock_result.volume = "테스트"
    mock_result.text = "텍스트"
    mock_result.score = 0.8
    mock_search.return_value = [mock_result]
    mock_stream.side_effect = Exception("Gemini API 타임아웃")

    response = client.post(
        "/chat/stream",
        json={"query": "테스트"},
    )

    assert response.status_code == 200
    events = parse_sse_data_lines(response.text)
    # sources는 정상 전송됨
    assert "sources" in events[0]
    # error 이벤트
    error_events = [e for e in events if "message" in e]
    assert len(error_events) == 1
    assert "Gemini API 타임아웃" in error_events[0]["message"]
```

**실행 명령어:**

```bash
cd backend && uv run pytest tests/test_stream.py -v
```

**Expected:** 4개 테스트 모두 통과

### Step 1.5: 기존 테스트 회귀 확인

- [ ] 기존 24개 테스트가 모두 통과하는지 확인

**실행 명령어:**

```bash
cd backend && uv run pytest -v
```

**Expected:** 24 + 4 = 28개 테스트 통과

---

## Task 2: Flutter 프로젝트 초기화

**Files:** `app/` 전체

### Step 2.1: Flutter 프로젝트 생성

- [ ] `flutter create`로 프로젝트 생성

**실행 명령어:**

```bash
cd /Users/woosung/project/agy-project/truewords-platform && flutter create app --org com.truewords --project-name truewords --platforms android,ios,web
```

**Expected:** `app/` 디렉토리 생성, `flutter run` 실행 가능

### Step 2.2: 의존성 추가

- [ ] pubspec.yaml에 필요 패키지 추가

```yaml
# app/pubspec.yaml
name: truewords
description: 가정연합 말씀 AI 챗봇
publish_to: 'none'
version: 0.2.0+1

environment:
  sdk: ^3.5.0
  flutter: ^3.24.0

dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.5.1
  riverpod_annotation: ^2.3.5
  go_router: ^14.2.7
  dio: ^5.7.0
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0
  uuid: ^4.4.2
  google_fonts: ^6.2.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  build_runner: ^2.4.12
  freezed: ^2.5.7
  json_serializable: ^6.8.0
  riverpod_generator: ^2.4.3
  mocktail: ^1.0.4
```

**실행 명령어:**

```bash
cd app && flutter pub get
```

**Expected:** 의존성 설치 성공

### Step 2.3: Feature-First 폴더 구조 생성

- [ ] 디렉토리 구조 생성

**실행 명령어:**

```bash
cd app && mkdir -p lib/core/{network,router,error,theme} \
  lib/features/chat/{presentation/{screens,widgets,providers},data/{repositories,models}} \
  test/features/chat/{data,presentation/widgets}
```

**Expected:** Feature-First 폴더 구조 생성 완료

---

## Task 3: core/ 설정 (Dio 네트워크, go_router, 에러 타입, 테마)

**Files:** `app/lib/core/`

### Step 3.1: 전역 에러 타입 정의

- [ ] `app/lib/core/error/app_error.dart` 생성
- [ ] freezed로 불변 에러 타입 정의

```dart
// app/lib/core/error/app_error.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'app_error.freezed.dart';

@freezed
sealed class AppError with _$AppError {
  const factory AppError.network({required String message}) = NetworkError;
  const factory AppError.server({required String message}) = ServerError;
  const factory AppError.timeout({required String message}) = TimeoutError;
  const factory AppError.streamDisconnected() = StreamDisconnectedError;
  const factory AppError.unknown({required String message}) = UnknownError;
}
```

### Step 3.2: Dio 클라이언트 설정

- [ ] `app/lib/core/network/dio_client.dart` 생성
- [ ] Riverpod Provider로 Dio 인스턴스 제공

```dart
// app/lib/core/network/dio_client.dart
import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'dio_client.g.dart';

const String _baseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:8000', // 안드로이드 에뮬레이터 기본값
);

@riverpod
Dio dio(DioRef ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 120), // SSE 스트리밍용 긴 타임아웃
      headers: {
        'Content-Type': 'application/json',
      },
    ),
  );

  dio.interceptors.add(LogInterceptor(
    requestBody: true,
    responseBody: false, // 스트리밍 응답은 로그 불필요
  ));

  return dio;
}
```

### Step 3.3: SSE 파싱 유틸리티

- [ ] `app/lib/core/network/sse_parser.dart` 생성
- [ ] `data: ` 접두사 라인을 JSON으로 파싱

```dart
// app/lib/core/network/sse_parser.dart
import 'dart:convert';

/// SSE "data: {...}" 라인을 JSON Map으로 파싱한다.
/// data: 접두사가 없는 라인은 null을 반환한다.
Map<String, dynamic>? parseSseLine(String line) {
  if (!line.startsWith('data: ')) return null;
  final jsonStr = line.substring(6).trim();
  if (jsonStr.isEmpty) return null;
  try {
    return json.decode(jsonStr) as Map<String, dynamic>;
  } catch (_) {
    return null;
  }
}

/// SSE data JSON의 이벤트 유형을 판별한다.
/// - sources: "sources" 키 존재
/// - text_delta: "text" 키 존재
/// - done: 빈 객체 {}
/// - error: "message" 키 존재
SseEventType classifySseEvent(Map<String, dynamic> data) {
  if (data.isEmpty) return SseEventType.done;
  if (data.containsKey('sources')) return SseEventType.sources;
  if (data.containsKey('text')) return SseEventType.textDelta;
  if (data.containsKey('message')) return SseEventType.error;
  return SseEventType.unknown;
}

enum SseEventType {
  sources,
  textDelta,
  done,
  error,
  unknown,
}
```

### Step 3.4: go_router 라우트 설정

- [ ] `app/lib/core/router/app_router.dart` 생성
- [ ] 채팅 화면 단일 라우트 (Phase 2)

```dart
// app/lib/core/router/app_router.dart
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:truewords/features/chat/presentation/screens/chat_screen.dart';

part 'app_router.g.dart';

@riverpod
GoRouter appRouter(AppRouterRef ref) {
  return GoRouter(
    initialLocation: '/chat',
    routes: [
      GoRoute(
        path: '/chat',
        name: 'chat',
        builder: (context, state) => const ChatScreen(),
      ),
    ],
  );
}
```

### Step 3.5: 앱 테마 설정

- [ ] `app/lib/core/theme/app_theme.dart` 생성
- [ ] 디자인 전략 문서(17-design-strategy.md)의 컬러 시스템 적용

```dart
// app/lib/core/theme/app_theme.dart
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppColors {
  // 디자인 전략 문서 기준
  static const primary = Color(0xFF2C3E6B);       // 따뜻한 남색
  static const secondary = Color(0xFFC9A96E);     // 부드러운 골드
  static const background = Color(0xFFF8F5F0);    // 따뜻한 아이보리
  static const surface = Color(0xFFFFFFFF);        // 화이트
  static const textPrimary = Color(0xFF2D2D2D);   // 차콜
  static const textSecondary = Color(0xFF6B6B6B);  // 웜 그레이
  static const success = Color(0xFF5B8C5A);        // 올리브 그린
  static const warning = Color(0xFFE8A838);        // 앰버
  static const error = Color(0xFFDC3545);          // 에러 레드
  static const userBubble = Color(0xFF2C3E6B);     // Primary (사용자 버블)
  static const aiBubble = Color(0xFFFFFFFF);       // Surface (AI 버블)
}

class AppTheme {
  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        primary: AppColors.primary,
        secondary: AppColors.secondary,
        surface: AppColors.surface,
        error: AppColors.error,
      ),
      scaffoldBackgroundColor: AppColors.background,
      textTheme: GoogleFonts.notoSansTextTheme().copyWith(
        // 일반 UI: Noto Sans 기반
        bodyLarge: GoogleFonts.notoSans(
          fontSize: 16,
          color: AppColors.textPrimary,
        ),
        bodyMedium: GoogleFonts.notoSans(
          fontSize: 14,
          color: AppColors.textPrimary,
        ),
        bodySmall: GoogleFonts.notoSans(
          fontSize: 12,
          color: AppColors.textSecondary,
        ),
        titleLarge: GoogleFonts.notoSans(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: GoogleFonts.notoSans(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE0E0E0)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
    );
  }
}
```

### Step 3.6: main.dart 진입점

- [ ] `app/lib/main.dart` 작성
- [ ] ProviderScope + MaterialApp.router

```dart
// app/lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:truewords/core/router/app_router.dart';
import 'package:truewords/core/theme/app_theme.dart';

void main() {
  runApp(
    const ProviderScope(
      child: TrueWordsApp(),
    ),
  );
}

class TrueWordsApp extends ConsumerWidget {
  const TrueWordsApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: '참말씀 AI 도우미',
      theme: AppTheme.lightTheme,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
```

### Step 3.7: 코드 생성 실행

- [ ] build_runner로 .g.dart, .freezed.dart 파일 생성

**실행 명령어:**

```bash
cd app && dart run build_runner build --delete-conflicting-outputs
```

**Expected:** `app_error.freezed.dart`, `dio_client.g.dart`, `app_router.g.dart` 생성

---

## Task 4: chat feature - models (freezed)

**Files:** `app/lib/features/chat/data/models/`

### Step 4.1: Source 모델

- [ ] `app/lib/features/chat/data/models/source.dart` 생성

```dart
// app/lib/features/chat/data/models/source.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'source.freezed.dart';
part 'source.g.dart';

@freezed
class Source with _$Source {
  const factory Source({
    required String volume,
    required String text,
    required double score,
  }) = _Source;

  factory Source.fromJson(Map<String, dynamic> json) => _$SourceFromJson(json);
}
```

### Step 4.2: ChatMessage 모델

- [ ] `app/lib/features/chat/data/models/chat_message.dart` 생성

```dart
// app/lib/features/chat/data/models/chat_message.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:truewords/features/chat/data/models/source.dart';

part 'chat_message.freezed.dart';
part 'chat_message.g.dart';

enum MessageRole { user, assistant }

@freezed
class ChatMessage with _$ChatMessage {
  const factory ChatMessage({
    required String id,
    required MessageRole role,
    required String content,
    @Default([]) List<Source> sources,
    @Default(false) bool isStreaming,
    @Default(false) bool isError,
  }) = _ChatMessage;

  factory ChatMessage.fromJson(Map<String, dynamic> json) =>
      _$ChatMessageFromJson(json);
}
```

### Step 4.3: ChatEvent (sealed class)

- [ ] `app/lib/features/chat/data/models/chat_event.dart` 생성
- [ ] SSE 이벤트를 도메인 이벤트로 변환하는 sealed class

```dart
// app/lib/features/chat/data/models/chat_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:truewords/features/chat/data/models/source.dart';

part 'chat_event.freezed.dart';

@freezed
sealed class ChatEvent with _$ChatEvent {
  const factory ChatEvent.sources({
    required List<Source> sources,
  }) = ChatEventSources;

  const factory ChatEvent.textDelta({
    required String text,
  }) = ChatEventTextDelta;

  const factory ChatEvent.done() = ChatEventDone;

  const factory ChatEvent.error({
    required String message,
  }) = ChatEventError;
}
```

### Step 4.4: 코드 생성

**실행 명령어:**

```bash
cd app && dart run build_runner build --delete-conflicting-outputs
```

**Expected:** `.freezed.dart`, `.g.dart` 파일 생성, 컴파일 에러 없음

---

## Task 5: chat feature - data (ChatRepository + SSE 파싱)

**Files:** `app/lib/features/chat/data/repositories/`

### Step 5.1: ChatRepository interface + impl

- [ ] `app/lib/features/chat/data/repositories/chat_repository.dart` 생성
- [ ] interface (abstract class) + impl 분리
- [ ] Riverpod Provider로 Repository 제공

```dart
// app/lib/features/chat/data/repositories/chat_repository.dart
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:truewords/core/network/dio_client.dart';
import 'package:truewords/core/network/sse_parser.dart';
import 'package:truewords/features/chat/data/models/chat_event.dart';
import 'package:truewords/features/chat/data/models/source.dart';

part 'chat_repository.g.dart';

/// 채팅 Repository 인터페이스
abstract class ChatRepository {
  /// SSE 스트리밍으로 채팅 이벤트를 스트림으로 반환한다.
  /// CancelToken으로 스트리밍을 취소할 수 있다.
  Stream<ChatEvent> streamChat({
    required String query,
    CancelToken? cancelToken,
  });
}

/// ChatRepository 구현체
class ChatRepositoryImpl implements ChatRepository {
  final Dio _dio;

  ChatRepositoryImpl(this._dio);

  @override
  Stream<ChatEvent> streamChat({
    required String query,
    CancelToken? cancelToken,
  }) async* {
    bool receivedDone = false;

    try {
      final response = await _dio.post<ResponseBody>(
        '/chat/stream',
        data: {'query': query},
        options: Options(responseType: ResponseType.stream),
        cancelToken: cancelToken,
      );

      final stream = response.data!.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .where((line) => line.startsWith('data: '))
          .map((line) => line.substring(6).trim())
          .where((data) => data.isNotEmpty);

      await for (final dataStr in stream) {
        Map<String, dynamic> json;
        try {
          json = jsonDecode(dataStr) as Map<String, dynamic>;
        } catch (_) {
          continue; // 잘못된 JSON 무시
        }

        final eventType = classifySseEvent(json);

        switch (eventType) {
          case SseEventType.sources:
            final sourcesList = (json['sources'] as List)
                .map((s) => Source.fromJson(s as Map<String, dynamic>))
                .toList();
            yield ChatEvent.sources(sources: sourcesList);

          case SseEventType.textDelta:
            yield ChatEvent.textDelta(text: json['text'] as String);

          case SseEventType.done:
            receivedDone = true;
            yield const ChatEvent.done();

          case SseEventType.error:
            yield ChatEvent.error(message: json['message'] as String);

          case SseEventType.unknown:
            continue; // 알 수 없는 이벤트 무시
        }
      }

      // 스트림 종료 후 done 미수신 → 연결 끊김
      if (!receivedDone) {
        yield const ChatEvent.error(
          message: '연결이 끊어졌습니다. 다시 시도해 주세요.',
        );
      }
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) {
        return; // 사용자가 취소한 경우
      }
      yield ChatEvent.error(
        message: e.message ?? '네트워크 오류가 발생했습니다.',
      );
    } catch (e) {
      yield ChatEvent.error(
        message: '알 수 없는 오류가 발생했습니다: $e',
      );
    }
  }
}

@riverpod
ChatRepository chatRepository(ChatRepositoryRef ref) {
  final dio = ref.watch(dioProvider);
  return ChatRepositoryImpl(dio);
}
```

### Step 5.2: 코드 생성

**실행 명령어:**

```bash
cd app && dart run build_runner build --delete-conflicting-outputs
```

**Expected:** `chat_repository.g.dart` 생성

---

## Task 6: chat feature - providers (ChatNotifier AsyncNotifier)

**Files:** `app/lib/features/chat/presentation/providers/`

### Step 6.1: ChatState + ChatNotifier

- [ ] `app/lib/features/chat/presentation/providers/chat_notifier.dart` 생성
- [ ] AsyncNotifier 사용 (StateNotifier 금지)
- [ ] CancelToken으로 스트리밍 취소 관리

```dart
// app/lib/features/chat/presentation/providers/chat_notifier.dart
import 'package:dio/dio.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:uuid/uuid.dart';
import 'package:truewords/features/chat/data/models/chat_event.dart';
import 'package:truewords/features/chat/data/models/chat_message.dart';
import 'package:truewords/features/chat/data/repositories/chat_repository.dart';

part 'chat_notifier.freezed.dart';
part 'chat_notifier.g.dart';

const _uuid = Uuid();

@freezed
class ChatState with _$ChatState {
  const factory ChatState({
    @Default([]) List<ChatMessage> messages,
    @Default(false) bool isStreaming,
    String? streamingMessageId,
  }) = _ChatState;
}

@riverpod
class ChatNotifier extends _$ChatNotifier {
  CancelToken? _cancelToken;

  @override
  Future<ChatState> build() async {
    // dispose 시 스트리밍 취소
    ref.onDispose(() {
      _cancelToken?.cancel('Notifier disposed');
    });
    return const ChatState();
  }

  /// 사용자 메시지를 추가하고 SSE 스트리밍을 시작한다.
  Future<void> sendMessage(String query) async {
    if (query.trim().isEmpty) return;

    final currentState = state.valueOrNull ?? const ChatState();

    // 진행 중인 스트리밍 취소
    _cancelToken?.cancel('New message sent');
    _cancelToken = CancelToken();

    // 사용자 메시지 추가
    final userMessage = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.user,
      content: query.trim(),
    );

    final assistantId = _uuid.v4();
    final assistantMessage = ChatMessage(
      id: assistantId,
      role: MessageRole.assistant,
      content: '',
      isStreaming: true,
    );

    state = AsyncData(currentState.copyWith(
      messages: [...currentState.messages, userMessage, assistantMessage],
      isStreaming: true,
      streamingMessageId: assistantId,
    ));

    // SSE 스트리밍 시작
    final repository = ref.read(chatRepositoryProvider);

    try {
      await for (final event in repository.streamChat(
        query: query.trim(),
        cancelToken: _cancelToken,
      )) {
        final s = state.valueOrNull;
        if (s == null) break;

        switch (event) {
          case ChatEventSources(:final sources):
            state = AsyncData(s.copyWith(
              messages: _updateMessage(s.messages, assistantId, (msg) {
                return msg.copyWith(sources: sources);
              }),
            ));

          case ChatEventTextDelta(:final text):
            state = AsyncData(s.copyWith(
              messages: _updateMessage(s.messages, assistantId, (msg) {
                return msg.copyWith(content: msg.content + text);
              }),
            ));

          case ChatEventDone():
            state = AsyncData(s.copyWith(
              messages: _updateMessage(s.messages, assistantId, (msg) {
                return msg.copyWith(isStreaming: false);
              }),
              isStreaming: false,
              streamingMessageId: null,
            ));

          case ChatEventError(:final message):
            state = AsyncData(s.copyWith(
              messages: _updateMessage(s.messages, assistantId, (msg) {
                return msg.copyWith(
                  content: msg.content.isEmpty ? message : msg.content,
                  isStreaming: false,
                  isError: true,
                );
              }),
              isStreaming: false,
              streamingMessageId: null,
            ));
        }
      }
    } catch (_) {
      // 스트림 에러는 repository에서 ChatEvent.error로 변환됨
      // 이 catch는 예상치 못한 에러만 처리
      final s = state.valueOrNull;
      if (s != null && s.isStreaming) {
        state = AsyncData(s.copyWith(
          messages: _updateMessage(s.messages, assistantId, (msg) {
            return msg.copyWith(
              content: msg.content.isEmpty
                  ? '오류가 발생했습니다.'
                  : msg.content,
              isStreaming: false,
              isError: true,
            );
          }),
          isStreaming: false,
          streamingMessageId: null,
        ));
      }
    }
  }

  /// 진행 중인 스트리밍을 취소한다.
  void cancelStream() {
    _cancelToken?.cancel('User cancelled');
    final s = state.valueOrNull;
    if (s == null) return;

    final assistantId = s.streamingMessageId;
    if (assistantId == null) return;

    state = AsyncData(s.copyWith(
      messages: _updateMessage(s.messages, assistantId, (msg) {
        return msg.copyWith(isStreaming: false);
      }),
      isStreaming: false,
      streamingMessageId: null,
    ));
  }

  /// 마지막 에러 메시지를 제거하고 재전송한다.
  Future<void> retryLastMessage() async {
    final s = state.valueOrNull;
    if (s == null) return;

    // 마지막 사용자 메시지 찾기
    final lastUserMessage = s.messages
        .where((m) => m.role == MessageRole.user)
        .lastOrNull;
    if (lastUserMessage == null) return;

    // 마지막 assistant 메시지 제거
    final messages = List<ChatMessage>.from(s.messages);
    final lastAssistantIdx = messages.lastIndexWhere(
      (m) => m.role == MessageRole.assistant,
    );
    if (lastAssistantIdx >= 0) {
      messages.removeAt(lastAssistantIdx);
    }

    state = AsyncData(s.copyWith(messages: messages));

    // 재전송
    await sendMessage(lastUserMessage.content);
  }

  /// 대화를 초기화한다.
  void clearMessages() {
    _cancelToken?.cancel('Messages cleared');
    state = const AsyncData(ChatState());
  }

  /// 특정 ID의 메시지를 업데이트하는 헬퍼
  List<ChatMessage> _updateMessage(
    List<ChatMessage> messages,
    String id,
    ChatMessage Function(ChatMessage) updater,
  ) {
    return messages.map((msg) {
      if (msg.id == id) return updater(msg);
      return msg;
    }).toList();
  }
}
```

### Step 6.2: 코드 생성

**실행 명령어:**

```bash
cd app && dart run build_runner build --delete-conflicting-outputs
```

**Expected:** `chat_notifier.freezed.dart`, `chat_notifier.g.dart` 생성

---

## Task 7: chat feature - presentation (UI 위젯)

**Files:** `app/lib/features/chat/presentation/`

### Step 7.1: StreamingIndicator 위젯

- [ ] 스트리밍 중 점 3개 애니메이션

```dart
// app/lib/features/chat/presentation/widgets/streaming_indicator.dart
import 'package:flutter/material.dart';
import 'package:truewords/core/theme/app_theme.dart';

class StreamingIndicator extends StatefulWidget {
  const StreamingIndicator({super.key});

  @override
  State<StreamingIndicator> createState() => _StreamingIndicatorState();
}

class _StreamingIndicatorState extends State<StreamingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: List.generate(3, (index) {
                  // 각 점이 시차를 두고 위아래로 움직임
                  final delay = index * 0.2;
                  final t = (_controller.value + delay) % 1.0;
                  final offset = (t < 0.5)
                      ? Curves.easeOut.transform(t * 2) * -4
                      : Curves.easeIn.transform((t - 0.5) * 2) * 4 - 4;
                  return Transform.translate(
                    offset: Offset(0, offset),
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 2),
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: AppColors.textSecondary,
                        shape: BoxShape.circle,
                      ),
                    ),
                  );
                }),
              );
            },
          ),
          const SizedBox(width: 8),
          Text(
            '말씀을 찾고 있습니다...',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondary,
                ),
          ),
        ],
      ),
    );
  }
}
```

### Step 7.2: EmptyStateWidget

```dart
// app/lib/features/chat/presentation/widgets/empty_state_widget.dart
import 'package:flutter/material.dart';
import 'package:truewords/core/theme/app_theme.dart';

class EmptyStateWidget extends StatelessWidget {
  const EmptyStateWidget({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.auto_stories_outlined,
            size: 64,
            color: AppColors.primary.withOpacity(0.3),
          ),
          const SizedBox(height: 16),
          Text(
            '참말씀 AI 도우미',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            '가정연합 말씀 615권 기반 AI 대화\n궁금한 것을 물어보세요',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                ),
          ),
        ],
      ),
    );
  }
}
```

### Step 7.3: MessageBubble 위젯

- [ ] 사용자/AI 메시지 구분
- [ ] 에러 상태 스타일
- [ ] 스트리밍 중 깜빡이는 커서

```dart
// app/lib/features/chat/presentation/widgets/message_bubble.dart
import 'package:flutter/material.dart';
import 'package:truewords/core/theme/app_theme.dart';
import 'package:truewords/features/chat/data/models/chat_message.dart';

class MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final VoidCallback? onRetry;

  const MessageBubble({
    super.key,
    required this.message,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == MessageRole.user;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.8,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: _bubbleColor(isUser),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
          border: message.isError
              ? Border.all(color: AppColors.error.withOpacity(0.3))
              : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 메시지 본문
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: message.content,
                    style: TextStyle(
                      fontSize: 15,
                      height: 1.5,
                      color: _textColor(isUser),
                    ),
                  ),
                  // 스트리밍 중 커서
                  if (message.isStreaming)
                    WidgetSpan(
                      child: _BlinkingCursor(),
                    ),
                ],
              ),
            ),
            // 에러 시 재시도 버튼
            if (message.isError && onRetry != null) ...[
              const SizedBox(height: 8),
              GestureDetector(
                onTap: onRetry,
                child: Text(
                  '다시 시도',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.error,
                    decoration: TextDecoration.underline,
                    decorationColor: AppColors.error,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Color _bubbleColor(bool isUser) {
    if (message.isError) return AppColors.error.withOpacity(0.05);
    return isUser ? AppColors.userBubble : AppColors.aiBubble;
  }

  Color _textColor(bool isUser) {
    if (message.isError) return AppColors.error;
    return isUser ? Colors.white : AppColors.textPrimary;
  }
}

class _BlinkingCursor extends StatefulWidget {
  @override
  State<_BlinkingCursor> createState() => _BlinkingCursorState();
}

class _BlinkingCursorState extends State<_BlinkingCursor>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _controller,
      child: Container(
        width: 2,
        height: 16,
        margin: const EdgeInsets.only(left: 2),
        color: AppColors.primary,
      ),
    );
  }
}
```

### Step 7.4: SourceCard 위젯

- [ ] 출처 정보 카드 (접이식)
- [ ] volume, text 일부, score 표시

```dart
// app/lib/features/chat/presentation/widgets/source_card.dart
import 'package:flutter/material.dart';
import 'package:truewords/core/theme/app_theme.dart';
import 'package:truewords/features/chat/data/models/source.dart';

class SourceCard extends StatefulWidget {
  final List<Source> sources;

  const SourceCard({super.key, required this.sources});

  @override
  State<SourceCard> createState() => _SourceCardState();
}

class _SourceCardState extends State<SourceCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    if (widget.sources.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 4, left: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 토글 버튼
          GestureDetector(
            onTap: () => setState(() => _isExpanded = !_isExpanded),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _isExpanded ? Icons.expand_less : Icons.expand_more,
                  size: 16,
                  color: AppColors.primary,
                ),
                const SizedBox(width: 4),
                Text(
                  '출처 ${widget.sources.length}건',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.primary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          // 펼쳐진 출처 목록
          if (_isExpanded)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                children: widget.sources.map((source) {
                  return Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.background,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: const Color(0xFFE0E0E0),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Flexible(
                              child: Text(
                                source.volume,
                                style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.textPrimary,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Text(
                              '유사도 ${(source.score * 100).toStringAsFixed(0)}%',
                              style: const TextStyle(
                                fontSize: 11,
                                color: AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          source.text,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textSecondary,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
        ],
      ),
    );
  }
}
```

### Step 7.5: ChatInputBar 위젯

- [ ] 입력 필드 + 전송/중지 버튼
- [ ] 스트리밍 중 비활성화

```dart
// app/lib/features/chat/presentation/widgets/chat_input_bar.dart
import 'package:flutter/material.dart';
import 'package:truewords/core/theme/app_theme.dart';

class ChatInputBar extends StatefulWidget {
  final ValueChanged<String> onSend;
  final VoidCallback onCancel;
  final bool isStreaming;

  const ChatInputBar({
    super.key,
    required this.onSend,
    required this.onCancel,
    required this.isStreaming,
  });

  @override
  State<ChatInputBar> createState() => _ChatInputBarState();
}

class _ChatInputBarState extends State<ChatInputBar> {
  final _controller = TextEditingController();
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() {
      final hasText = _controller.text.trim().isNotEmpty;
      if (hasText != _hasText) {
        setState(() => _hasText = hasText);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleSend() {
    final text = _controller.text.trim();
    if (text.isEmpty || widget.isStreaming) return;
    widget.onSend(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 16,
        right: 8,
        top: 8,
        bottom: MediaQuery.of(context).padding.bottom + 8,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: Colors.grey.shade200),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // 입력 필드
          Expanded(
            child: TextField(
              controller: _controller,
              maxLines: 4,
              minLines: 1,
              enabled: !widget.isStreaming,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _handleSend(),
              decoration: InputDecoration(
                hintText: '말씀에 대해 궁금한 것을 물어보세요...',
                hintStyle: TextStyle(
                  color: AppColors.textSecondary.withOpacity(0.5),
                  fontSize: 14,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: const BorderSide(color: AppColors.primary),
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                filled: true,
                fillColor: AppColors.background,
              ),
            ),
          ),
          const SizedBox(width: 8),
          // 전송/중지 버튼
          if (widget.isStreaming)
            IconButton(
              onPressed: widget.onCancel,
              icon: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.error,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Icon(
                  Icons.stop,
                  color: Colors.white,
                  size: 20,
                ),
              ),
            )
          else
            IconButton(
              onPressed: _hasText ? _handleSend : null,
              icon: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: _hasText
                      ? AppColors.primary
                      : AppColors.primary.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Icon(
                  Icons.arrow_upward,
                  color: Colors.white,
                  size: 20,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
```

### Step 7.6: ChatScreen (메인 화면)

- [ ] ConsumerWidget으로 Riverpod 연결
- [ ] AsyncValue.when()으로 상태별 UI 렌더링
- [ ] ListView.builder로 메시지 목록 가상화

```dart
// app/lib/features/chat/presentation/screens/chat_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:truewords/core/theme/app_theme.dart';
import 'package:truewords/features/chat/data/models/chat_message.dart';
import 'package:truewords/features/chat/presentation/providers/chat_notifier.dart';
import 'package:truewords/features/chat/presentation/widgets/chat_input_bar.dart';
import 'package:truewords/features/chat/presentation/widgets/empty_state_widget.dart';
import 'package:truewords/features/chat/presentation/widgets/message_bubble.dart';
import 'package:truewords/features/chat/presentation/widgets/source_card.dart';
import 'package:truewords/features/chat/presentation/widgets/streaming_indicator.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final chatAsync = ref.watch(chatNotifierProvider);

    // 메시지가 갱신될 때 자동 스크롤
    ref.listen(chatNotifierProvider, (prev, next) {
      final prevCount = prev?.valueOrNull?.messages.length ?? 0;
      final nextCount = next.valueOrNull?.messages.length ?? 0;
      final nextStreaming = next.valueOrNull?.isStreaming ?? false;
      if (nextCount > prevCount || nextStreaming) {
        _scrollToBottom();
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('참말씀 AI 도우미'),
            Text(
              '가정연합 말씀 615권 기반 AI 대화',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.normal,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(
            height: 1,
            color: Colors.grey.shade200,
          ),
        ),
      ),
      body: chatAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('오류: $error')),
        data: (chatState) {
          return Column(
            children: [
              // 메시지 목록
              Expanded(
                child: chatState.messages.isEmpty
                    ? const EmptyStateWidget()
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        itemCount: chatState.messages.length +
                            (chatState.isStreaming ? 1 : 0),
                        itemBuilder: (context, index) {
                          // 마지막 아이템: 스트리밍 인디케이터
                          if (index == chatState.messages.length) {
                            return const StreamingIndicator();
                          }

                          final message = chatState.messages[index];
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              MessageBubble(
                                message: message,
                                onRetry: message.isError
                                    ? () => ref
                                        .read(chatNotifierProvider.notifier)
                                        .retryLastMessage()
                                    : null,
                              ),
                              // AI 메시지 + 출처 있음 + 스트리밍 완료
                              if (message.role == MessageRole.assistant &&
                                  message.sources.isNotEmpty &&
                                  !message.isStreaming)
                                SourceCard(sources: message.sources),
                            ],
                          );
                        },
                      ),
              ),
              // 면책 고지
              if (chatState.messages.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 4,
                  ),
                  child: Text(
                    'AI 답변은 참고용이며 목회자 상담을 대체하지 않습니다.',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary.withOpacity(0.6),
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              // 입력바
              ChatInputBar(
                onSend: (query) => ref
                    .read(chatNotifierProvider.notifier)
                    .sendMessage(query),
                onCancel: () =>
                    ref.read(chatNotifierProvider.notifier).cancelStream(),
                isStreaming: chatState.isStreaming,
              ),
            ],
          );
        },
      ),
    );
  }
}
```

**실행 명령어:**

```bash
cd app && dart run build_runner build --delete-conflicting-outputs && flutter analyze
```

**Expected:** 코드 생성 완료, 분석 에러 없음

---

## Task 8: Flutter 테스트

**Files:** `app/test/`

### Step 8.1: SSE 파싱 단위 테스트

```dart
// app/test/features/chat/data/sse_parser_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:truewords/core/network/sse_parser.dart';

void main() {
  group('parseSseLine', () {
    test('정상적인 data: 라인을 파싱한다', () {
      final result = parseSseLine('data: {"text": "안녕하세요"}');
      expect(result, {'text': '안녕하세요'});
    });

    test('data: 접두사가 없는 라인은 null을 반환한다', () {
      expect(parseSseLine('event: token'), isNull);
      expect(parseSseLine(''), isNull);
      expect(parseSseLine(':keepalive'), isNull);
    });

    test('빈 JSON도 파싱한다 (done 이벤트)', () {
      final result = parseSseLine('data: {}');
      expect(result, {});
    });

    test('잘못된 JSON은 null을 반환한다', () {
      expect(parseSseLine('data: not-json'), isNull);
    });

    test('sources 이벤트를 파싱한다', () {
      final result = parseSseLine(
        'data: {"sources": [{"volume": "test", "text": "txt", "score": 0.8}]}',
      );
      expect(result, isNotNull);
      expect(result!['sources'], isList);
    });
  });

  group('classifySseEvent', () {
    test('sources 이벤트를 판별한다', () {
      expect(
        classifySseEvent({'sources': []}),
        SseEventType.sources,
      );
    });

    test('textDelta 이벤트를 판별한다', () {
      expect(
        classifySseEvent({'text': '안녕'}),
        SseEventType.textDelta,
      );
    });

    test('done 이벤트를 판별한다 (빈 객체)', () {
      expect(
        classifySseEvent({}),
        SseEventType.done,
      );
    });

    test('error 이벤트를 판별한다', () {
      expect(
        classifySseEvent({'message': '오류 발생'}),
        SseEventType.error,
      );
    });

    test('알 수 없는 이벤트는 unknown', () {
      expect(
        classifySseEvent({'foo': 'bar'}),
        SseEventType.unknown,
      );
    });
  });
}
```

### Step 8.2: ChatRepository 목 테스트

```dart
// app/test/features/chat/data/chat_repository_test.dart
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:truewords/features/chat/data/models/chat_event.dart';
import 'package:truewords/features/chat/data/repositories/chat_repository.dart';

class MockDio extends Mock implements Dio {}

class MockResponseBody extends Mock implements ResponseBody {}

void main() {
  late MockDio mockDio;
  late ChatRepositoryImpl repository;

  setUp(() {
    mockDio = MockDio();
    repository = ChatRepositoryImpl(mockDio);
  });

  setUpAll(() {
    registerFallbackValue(Options());
    registerFallbackValue(CancelToken());
  });

  group('streamChat', () {
    test('정상 SSE 스트림을 ChatEvent 시퀀스로 변환한다', () async {
      // SSE 응답 시뮬레이션
      final sseLines = [
        'data: {"sources": [{"volume": "테스트권", "text": "본문", "score": 0.9}]}\n',
        '\n',
        'data: {"text": "답변 "}\n',
        '\n',
        'data: {"text": "내용"}\n',
        '\n',
        'data: {}\n',
        '\n',
      ].join();

      final responseBody = MockResponseBody();
      when(() => responseBody.stream).thenAnswer(
        (_) => Stream.value(utf8.encode(sseLines)),
      );

      when(() => mockDio.post<ResponseBody>(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(),
          data: responseBody,
          statusCode: 200,
        ),
      );

      final events = await repository
          .streamChat(query: '테스트 질문')
          .toList();

      expect(events.length, 4);
      expect(events[0], isA<ChatEventSources>());
      expect(events[1], isA<ChatEventTextDelta>());
      expect(events[2], isA<ChatEventTextDelta>());
      expect(events[3], isA<ChatEventDone>());

      // sources 내용 검증
      final sourcesEvent = events[0] as ChatEventSources;
      expect(sourcesEvent.sources.length, 1);
      expect(sourcesEvent.sources[0].volume, '테스트권');

      // text_delta 내용 검증
      final textEvent1 = events[1] as ChatEventTextDelta;
      expect(textEvent1.text, '답변 ');
    });

    test('done 이벤트 없이 스트림 종료 시 연결 끊김 에러를 발생시킨다', () async {
      // done 없이 종료되는 SSE
      final sseLines = [
        'data: {"sources": []}\n',
        '\n',
        'data: {"text": "부분 답변"}\n',
        '\n',
      ].join();

      final responseBody = MockResponseBody();
      when(() => responseBody.stream).thenAnswer(
        (_) => Stream.value(utf8.encode(sseLines)),
      );

      when(() => mockDio.post<ResponseBody>(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(),
          data: responseBody,
          statusCode: 200,
        ),
      );

      final events = await repository
          .streamChat(query: '테스트')
          .toList();

      // 마지막 이벤트가 연결 끊김 에러
      expect(events.last, isA<ChatEventError>());
      final errorEvent = events.last as ChatEventError;
      expect(errorEvent.message, contains('연결이 끊어졌습니다'));
    });

    test('Dio 취소 시 이벤트 없이 종료한다', () async {
      when(() => mockDio.post<ResponseBody>(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
            cancelToken: any(named: 'cancelToken'),
          )).thenThrow(
        DioException(
          type: DioExceptionType.cancel,
          requestOptions: RequestOptions(),
        ),
      );

      final events = await repository
          .streamChat(query: '취소 테스트')
          .toList();

      expect(events, isEmpty);
    });
  });
}
```

### Step 8.3: MessageBubble Widget 테스트

```dart
// app/test/features/chat/presentation/widgets/message_bubble_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truewords/features/chat/data/models/chat_message.dart';
import 'package:truewords/features/chat/presentation/widgets/message_bubble.dart';

void main() {
  Widget buildTestWidget(ChatMessage message, {VoidCallback? onRetry}) {
    return MaterialApp(
      home: Scaffold(
        body: MessageBubble(
          message: message,
          onRetry: onRetry,
        ),
      ),
    );
  }

  group('MessageBubble', () {
    testWidgets('사용자 메시지를 표시한다', (tester) async {
      final message = ChatMessage(
        id: '1',
        role: MessageRole.user,
        content: '축복이란 무엇인가요?',
      );

      await tester.pumpWidget(buildTestWidget(message));

      expect(find.text('축복이란 무엇인가요?'), findsOneWidget);
    });

    testWidgets('AI 메시지를 표시한다', (tester) async {
      final message = ChatMessage(
        id: '2',
        role: MessageRole.assistant,
        content: '참부모님의 말씀에 따르면...',
      );

      await tester.pumpWidget(buildTestWidget(message));

      expect(find.text('참부모님의 말씀에 따르면...'), findsOneWidget);
    });

    testWidgets('에러 상태에서 재시도 버튼을 표시한다', (tester) async {
      bool retried = false;
      final message = ChatMessage(
        id: '3',
        role: MessageRole.assistant,
        content: '오류가 발생했습니다.',
        isError: true,
      );

      await tester.pumpWidget(buildTestWidget(
        message,
        onRetry: () => retried = true,
      ));

      expect(find.text('다시 시도'), findsOneWidget);

      await tester.tap(find.text('다시 시도'));
      expect(retried, isTrue);
    });

    testWidgets('에러 아닌 상태에서는 재시도 버튼이 없다', (tester) async {
      final message = ChatMessage(
        id: '4',
        role: MessageRole.assistant,
        content: '정상 답변입니다.',
      );

      await tester.pumpWidget(buildTestWidget(message));

      expect(find.text('다시 시도'), findsNothing);
    });
  });
}
```

### Step 8.4: SourceCard Widget 테스트

```dart
// app/test/features/chat/presentation/widgets/source_card_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truewords/features/chat/data/models/source.dart';
import 'package:truewords/features/chat/presentation/widgets/source_card.dart';

void main() {
  Widget buildTestWidget(List<Source> sources) {
    return MaterialApp(
      home: Scaffold(
        body: SourceCard(sources: sources),
      ),
    );
  }

  group('SourceCard', () {
    testWidgets('출처 개수를 표시한다', (tester) async {
      final sources = [
        const Source(volume: '축복행정 규정집', text: '본문', score: 0.85),
        const Source(volume: '말씀선집 제1권', text: '본문2', score: 0.80),
      ];

      await tester.pumpWidget(buildTestWidget(sources));

      expect(find.text('출처 2건'), findsOneWidget);
    });

    testWidgets('탭 시 출처 상세를 펼친다', (tester) async {
      final sources = [
        const Source(volume: '축복행정 규정집', text: '테스트 본문', score: 0.85),
      ];

      await tester.pumpWidget(buildTestWidget(sources));

      // 초기: 접힌 상태
      expect(find.text('축복행정 규정집'), findsNothing);

      // 탭: 펼쳐짐
      await tester.tap(find.text('출처 1건'));
      await tester.pumpAndSettle();

      expect(find.text('축복행정 규정집'), findsOneWidget);
      expect(find.text('유사도 85%'), findsOneWidget);
    });

    testWidgets('빈 출처 목록은 아무것도 렌더링하지 않는다', (tester) async {
      await tester.pumpWidget(buildTestWidget([]));

      expect(find.byType(SizedBox), findsWidgets);
    });
  });
}
```

### Step 8.5: ChatInputBar Widget 테스트

```dart
// app/test/features/chat/presentation/widgets/chat_input_bar_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truewords/features/chat/presentation/widgets/chat_input_bar.dart';

void main() {
  Widget buildTestWidget({
    required ValueChanged<String> onSend,
    required VoidCallback onCancel,
    bool isStreaming = false,
  }) {
    return MaterialApp(
      home: Scaffold(
        body: ChatInputBar(
          onSend: onSend,
          onCancel: onCancel,
          isStreaming: isStreaming,
        ),
      ),
    );
  }

  group('ChatInputBar', () {
    testWidgets('텍스트 입력 후 전송 버튼으로 메시지를 전송한다', (tester) async {
      String? sentMessage;

      await tester.pumpWidget(buildTestWidget(
        onSend: (msg) => sentMessage = msg,
        onCancel: () {},
      ));

      // 텍스트 입력
      await tester.enterText(find.byType(TextField), '테스트 질문');
      await tester.pump();

      // 전송 버튼 탭 (arrow_upward 아이콘이 있는 IconButton)
      await tester.tap(find.byIcon(Icons.arrow_upward));
      await tester.pump();

      expect(sentMessage, '테스트 질문');
    });

    testWidgets('스트리밍 중에는 입력 필드가 비활성화된다', (tester) async {
      await tester.pumpWidget(buildTestWidget(
        onSend: (_) {},
        onCancel: () {},
        isStreaming: true,
      ));

      final textField = tester.widget<TextField>(find.byType(TextField));
      expect(textField.enabled, isFalse);
    });

    testWidgets('스트리밍 중에는 중지 버튼이 표시된다', (tester) async {
      bool cancelled = false;

      await tester.pumpWidget(buildTestWidget(
        onSend: (_) {},
        onCancel: () => cancelled = true,
        isStreaming: true,
      ));

      expect(find.byIcon(Icons.stop), findsOneWidget);

      await tester.tap(find.byIcon(Icons.stop));
      expect(cancelled, isTrue);
    });
  });
}
```

**실행 명령어:**

```bash
# Flutter 테스트
cd app && flutter test

# 백엔드 전체 테스트 (회귀 포함)
cd backend && uv run pytest -v
```

**Expected:**
- Flutter: SSE 파싱 5개 + Repository 3개 + Widget 10개 = 18개 테스트 통과
- Backend: 24 + 4 = 28개 테스트 통과

---

## Task 9: 통합 검증

### Step 9.1: 백엔드 + Flutter 동시 실행

**실행 명령어:**

```bash
# 터미널 1: 백엔드
cd backend && docker compose up -d  # Qdrant
cd backend && uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 터미널 2: Flutter
cd app && flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8000
# 또는 모바일
cd app && flutter run -d <device> --dart-define=API_BASE_URL=http://<PC_IP>:8000
```

### Step 9.2: 수동 테스트 체크리스트

- [ ] 앱에서 질문 입력 → SSE 토큰 스트리밍 확인 (타이핑 효과)
- [ ] 답변 완료 후 출처 카드 펼치기/접기
- [ ] 연속 질문 2~3회 → 메시지 목록 누적 + 자동 스크롤
- [ ] 스트리밍 중 "중지" 버튼 → 스트리밍 중단
- [ ] 빈 입력 → 전송 버튼 비활성화
- [ ] 면책 고지 문구 표시 확인

### Step 9.3: 에러 시나리오 테스트

- [ ] 백엔드 꺼진 상태에서 질문 → 에러 메시지 + 재시도 버튼
- [ ] 에러 발생 후 재시도 버튼 → 마지막 질문 재전송
- [ ] 매우 긴 질문 (1000자) → 정상 동작 확인

### Step 9.4: curl SSE 검증

```bash
curl -N -X POST http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"query": "축복이란 무엇인가요?"}' 2>&1
```

**Expected:** `data: {"sources": [...]}`, `data: {"text": "..."}` (반복), `data: {}` 순서

---

## Self-Review 체크리스트

### 스펙 커버리지

| 스펙 항목 | 구현 위치 | 상태 |
|----------|----------|------|
| POST /chat/stream SSE | Task 1 (routes.py) | O |
| SSE 이벤트 스키마 (sources/text_delta/done/error) | Task 1 Step 1.2 | O |
| Flutter 채팅 UI | Task 2~7 | O |
| 타이핑 효과 (깜빡이는 커서) | Task 7.3 (MessageBubble) | O |
| 출처 카드 (접이식) | Task 7.4 (SourceCard) | O |
| 에러/재시도 UI | Task 7.3 + Task 6.1 (retryLastMessage) | O |
| 스트리밍 인디케이터 | Task 7.1 (StreamingIndicator) | O |
| 연결 끊김 감지 | Task 5.1 (receivedDone 플래그) | O |
| CORS | Task 1.3 | O |
| 기존 /chat 회귀 없음 | Task 1.5 | O |
| Feature-First 구조 | Task 2.3 | O |
| Riverpod AsyncNotifier | Task 6.1 | O |
| freezed 모델 | Task 4 | O |
| go_router | Task 3.4 | O |
| Dio SSE stream | Task 5.1 | O |
| 디자인 시스템 (컬러) | Task 3.5 | O |
| 면책 고지 | Task 7.6 (ChatScreen) | O |

### Placeholder 스캔

- [x] 모든 코드 블록이 실행 가능한 완전한 코드
- [x] `TODO`, `FIXME`, `...` 없음
- [x] import 경로 모두 명시

### 타입 일관성

- [x] 백엔드 Source → SSE JSON → Flutter Source (freezed) 필드 일치 (volume, text, score)
- [x] ChatRequest → Dio body 일치 (query)
- [x] SSE data 포맷 → sse_parser → ChatEvent 변환 일치
- [x] ChatMessage (freezed) ↔ MessageBubble props 일치

### Flutter 규칙 준수

- [x] StateNotifier 사용 없음 → AsyncNotifier만 사용
- [x] Navigator.push 사용 없음 → go_router만 사용
- [x] build()에서 ref.read() 사용 없음 → ref.watch()만 사용
- [x] freezed 없이 copyWith 수동 작성 없음 → 모든 모델 freezed
- [x] 다른 feature 내부 import 없음 (chat feature만 존재)
- [x] Repository interface + impl 분리

---

## Engineering Review Report

**리뷰 일시:** 2026-03-28
**리뷰어:** AI Engineering Review

### 1. 아키텍처 경계 검토

| 항목 | 판정 | 비고 |
|------|------|------|
| Feature-First 구조 | PASS | `features/chat/` 하위에 presentation, data 분리 |
| Riverpod 패턴 | PASS | AsyncNotifier, build()에서 ref.watch(), 이벤트에서 ref.read() |
| Repository 분리 | PASS | abstract ChatRepository + ChatRepositoryImpl |
| core/ 독립성 | PASS | network, router, error, theme가 feature에 무의존 |

### 2. 데이터 흐름 검증

```
SSE (backend)
  → Dio ResponseType.stream
  → utf8.decoder → LineSplitter → data: 필터
  → ChatRepositoryImpl (parseSseLine + classifySseEvent → ChatEvent)
  → ChatNotifier (switch 패턴 매칭 → state 갱신)
  → ConsumerWidget (AsyncValue.when → UI 렌더링)
```

- PASS: 각 레이어 경계가 명확하고, sealed class(ChatEvent)로 타입 안전한 이벤트 처리

### 3. 테스트 커버리지 분석

```
백엔드 테스트 (pytest)
==================================================
기존 테스트:               24개 (회귀 테스트)
신규 테스트:                4개
--------------------------------------------------
  test_chat_stream_success          [정상 플로우]
  test_chat_stream_search_error     [검색 실패]
  test_chat_stream_empty_results    [빈 결과]
  test_chat_stream_generation_error [LLM 실패]
--------------------------------------------------
합계:                      28개

Flutter 테스트
==================================================
단위 테스트:
  SSE 파싱 (sse_parser_test)        5개
  Repository (chat_repository_test) 3개
Widget 테스트:
  MessageBubble                     4개
  SourceCard                        3개
  ChatInputBar                      3개
--------------------------------------------------
합계:                               18개

총 테스트:                          46개
```

### 4. 성능 검토

| 항목 | 판정 | 비고 |
|------|------|------|
| 스트리밍 메모리 관리 | PASS | ListView.builder 가상화, CancelToken dispose |
| dispose 처리 | PASS | ref.onDispose()에서 CancelToken 취소 |
| 자동 스크롤 | WARNING | 스트리밍 중 매 토큰마다 스크롤 → 아래 이슈 #2 참고 |
| SSE 버퍼링 | PASS | LineSplitter가 완전한 라인만 처리 |

### 5. 실패 모드 목록

| # | 실패 시나리오 | 백엔드 동작 | Flutter 동작 |
|---|-------------|-----------|------------|
| 1 | Qdrant 연결 실패 | error SSE 이벤트 전송 | 에러 메시지 + 재시도 버튼 |
| 2 | Gemini API 타임아웃 | error SSE 이벤트 전송 | 에러 메시지 + 재시도 버튼 |
| 3 | Gemini 스트리밍 중 부분 실패 | sources 전송 후 error 이벤트 | 에러 메시지 (부분 답변 유지) |
| 4 | 네트워크 끊김 | generator 자동 정리 | DioException → 에러 메시지 |
| 5 | done 없이 스트림 종료 | - | receivedDone=false → "연결 끊김" 에러 |
| 6 | 사용자 취소 (중지 버튼) | - | CancelToken.cancel() → 스트리밍 중단 |
| 7 | 잘못된 JSON body | FastAPI 422 응답 | DioException → 에러 메시지 |
| 8 | 동시 다수 요청 | 각 요청 독립 처리 | 이전 CancelToken 취소 → 최신 요청만 |

### 6. 발견된 이슈 + 해결 여부

| # | 이슈 | 심각도 | 해결 |
|---|------|--------|------|
| 1 | `generate_answer_stream()` 부분 예외 시 sources 이미 전송됨 | 중 | 이미 해결: ChatNotifier에서 error 수신 시 content가 비어있으면 에러 메시지로 교체, 아니면 부분 답변 유지 + isError 마킹 |
| 2 | ref.listen으로 매 토큰마다 _scrollToBottom 호출 가능 | 낮 | 허용: animateTo가 이미 진행 중이면 무시됨. 최적화 필요 시 debounce 추가 (Phase 3) |
| 3 | Android 에뮬레이터 기본 API URL이 10.0.2.2 (로컬호스트 매핑) | 낮 | 이미 해결: `--dart-define=API_BASE_URL`로 런타임 오버라이드 가능 |
| 4 | iOS 시뮬레이터에서는 localhost 직접 접근 가능하나 실기기에서는 불가 | 낮 | 허용: 개발 단계에서는 같은 네트워크의 PC IP 사용. 프로덕션에서는 도메인 사용. |
| 5 | StreamingIndicator에서 AnimatedBuilder 대신 AnimatedWidget 사용 가능 | 낮 | 허용: 현재 구현으로 정상 동작. 코드 간결화는 리팩토링 시 진행 |
| 6 | ChatNotifier에서 sendMessage 재진입 방지 없음 | 중 | **수정 필요**: sendMessage 시작 시 isStreaming이면 early return 추가 |

### 이슈 #6 수정: sendMessage 재진입 방지

ChatNotifier.sendMessage() 시작부에 다음 가드를 추가한다:

```dart
Future<void> sendMessage(String query) async {
    if (query.trim().isEmpty) return;

    final currentState = state.valueOrNull ?? const ChatState();
    // 재진입 방지: 스트리밍 중이면 무시
    if (currentState.isStreaming) return;

    // ... 나머지 동일
}
```

이 수정은 구현 시 Task 6 Step 6.1 코드에 반영해야 한다.

### 최종 판정

**APPROVED WITH CHANGES**

변경 사항:
1. ChatNotifier.sendMessage()에 재진입 방지 가드 추가 (이슈 #6)

위 1가지를 구현 시 반영하면 된다. 나머지 이슈는 이미 코드에 반영되었거나 허용 범위 내이다.

---

## 요약

| 항목 | 수량 |
|------|------|
| 총 Task 수 | 9개 |
| 총 Step 수 | 24개 |
| 백엔드 신규 테스트 | 4개 |
| Flutter 신규 테스트 | 18개 |
| 기존 테스트 (회귀) | 24개 |
| 총 테스트 | 46개 |
| 백엔드 수정 파일 | 3개 |
| Flutter 신규 파일 | 22개+ |
| 발견 이슈 | 6개 (1개 수정 반영, 5개 이미 해결 또는 허용) |
| 최종 판정 | APPROVED WITH CHANGES |
