# 인기 질문 상세 모달 설계

- **작성일:** 2026-04-21
- **대상 페이지:** Admin Dashboard `/analytics` (검색 분석)
- **신규 기능:** 인기 질문 Top 10 테이블에서 행 클릭 시, 해당 질문의 모든 발생(occurrence)에 대한 **봇·질문·재작성쿼리·답변·매칭 출처·피드백**을 한 모달에서 분석할 수 있게 한다.

---

## 1. 배경 & 목적

현재 `/analytics` 페이지의 "인기 질문 Top 10"은 `query_text`와 `count`만 노출한다.
운영자가 **"동일 질문이 봇마다/시점마다 어떻게 처리되었는지"** 확인할 방법이 없어, RAG 품질 개선을 위한 근거 수집이 어렵다.

이미 DB에는 충분한 원본 로그가 저장되어 있다:

- `search_events` — 쿼리, 재작성 쿼리, tier, latency
- `session_messages` — user/assistant 메시지
- `answer_citations` — 매칭 출처 (source/volume/chapter/snippet/score)
- `research_sessions` — 챗봇 config 연결
- `chatbot_configs` — `display_name`
- `answer_feedback` — 피드백

이 데이터를 **원 클릭 모달**로 노출해 분석 도구로 활용한다.

---

## 2. 범위

### 포함

- 인기 질문 Top 10 테이블 행 클릭 → 상세 모달 오픈
- 모달 내 모든 발생을 아코디언으로 나열 (최신순, 최대 50건)
- 각 발생에서 봇명/시점/재작성쿼리/검색지표/답변/출처/피드백 표시
- 새 백엔드 엔드포인트 `GET /admin/analytics/search/query-details`

### 제외 (YAGNI)

- 피드백 대시보드·감사 로그에서 이 모달 재사용
- CSV 내보내기
- 발생 수 > 50인 경우의 페이지네이션
- Top 10 이외 지점(차트 등)에서의 진입점
- 모달 내 실시간 피드백 수정/삭제 등 변경 기능 (읽기 전용)

---

## 3. 아키텍처

### 3.1 데이터 흐름

```
[TopQueriesTable row click]
  → setSelectedQuery(query_text)
  → QueryDetailModal (open=true)
  → useQuery(getQueryDetails(query_text, days=30))
  → GET /admin/analytics/search/query-details?query_text=...&days=30&limit=50
  → AnalyticsRepository.get_query_details()
  → 단일 쿼리로 search_events + session_messages(user/assistant)
    + answer_citations + chatbot_configs + answer_feedback JOIN
  → QueryDetailResponse
  → 모달: 상단 요약 + 발생 아코디언 N개
```

### 3.2 백엔드

```
backend/src/admin/
├── analytics_router.py       # GET /search/query-details 엔드포인트 추가
├── analytics_repository.py   # get_query_details() 메서드 추가
└── analytics_schemas.py      # QueryDetailResponse, QueryOccurrence,
                              # CitationItem, FeedbackItem 추가

# 주: analytics 도메인은 현재 service layer 없이 Router → Repository 직접 호출 구조.
#     본 기능도 동일 패턴 유지 (`get_top_queries`와 동일).
```

### 3.3 프론트엔드

```
admin/src/features/analytics/
├── api.ts                              # getQueryDetails(queryText, days) 추가
├── types.ts                            # QueryDetail, QueryOccurrence 등 타입
└── components/
    └── query-detail-modal.tsx          # 🆕 신규 모달 컴포넌트

admin/src/app/(dashboard)/analytics/
└── page.tsx                            # TopQueriesTable 행에 onClick + 상태 관리
```

---

## 4. API 명세

### 4.1 엔드포인트

`GET /admin/analytics/search/query-details`

**Query Parameters**

| 이름         | 타입   | 필수 | 기본 | 제약              | 설명                          |
|--------------|--------|------|------|-------------------|-------------------------------|
| `query_text` | string | ✅   | —    | 1~1000자          | 조회할 정확한 질문 텍스트     |
| `days`       | int    | ❌   | 30   | 1~365             | 최근 N일 범위                 |
| `limit`      | int    | ❌   | 50   | 1~100             | 최대 발생 수                  |

**인증**: `get_current_admin` 의존성 (기존 analytics 라우터와 동일)

### 4.2 응답 스키마 (`analytics_schemas.py`)

```python
class CitationItem(BaseModel):
    source: str               # "A" | "B" | "C" | "L" | "D" 등
    volume: int
    chapter: str | None = None
    text_snippet: str
    relevance_score: float
    rank_position: int

class FeedbackItem(BaseModel):
    feedback_type: str        # helpful | inaccurate | missing_citation | irrelevant | other
    comment: str | None = None
    created_at: datetime

class QueryOccurrence(BaseModel):
    search_event_id: UUID
    user_message_id: UUID
    assistant_message_id: UUID | None  # 답변이 저장되지 않은 경우 null
    session_id: UUID
    chatbot_id: UUID | None
    chatbot_name: str | None           # chatbot_configs.display_name (삭제 시 null)
    asked_at: datetime                 # session_messages.created_at (user 메시지)
    rewritten_query: str | None
    search_tier: int
    total_results: int
    latency_ms: int
    applied_filters: dict              # search_events.applied_filters JSON
    answer_text: str | None            # assistant 메시지 content
    citations: list[CitationItem]      # rank_position asc
    feedback: FeedbackItem | None      # 있으면 최신 1건

class QueryDetailResponse(BaseModel):
    query_text: str
    total_count: int                   # 기간 내 전체 발생 수
    returned_count: int                # 응답에 포함된 발생 수 (≤ limit)
    days: int
    occurrences: list[QueryOccurrence] # asked_at desc
```

### 4.3 쿼리 전략

1. **발생 목록 조회** — `search_events` + `session_messages`(user) + `research_sessions` + `chatbot_configs` LEFT JOIN
   - `WHERE session_messages.content = :query_text AND search_events.created_at >= :cutoff`
   - `ORDER BY session_messages.created_at DESC LIMIT :limit`
   - user message_id 리스트 확보
2. **답변 조회** — 각 user message에 대해 **같은 session 내 created_at이 더 크고 role=assistant인 최초 메시지**
   - Python 측에서 session별로 묶어 1회에 조회 (`WHERE session_id IN (...)`), 메모리에서 매칭
3. **출처 조회** — `answer_citations WHERE message_id IN (user_message_ids) ORDER BY rank_position ASC`
4. **피드백 조회** — `answer_feedback WHERE message_id IN (user_message_ids)` → 최신 1건만
5. **총 발생 수** — 별도 COUNT 쿼리 (limit과 무관하게 전체 수 필요)

> **N+1 방지**: 모든 보조 쿼리는 user_message_ids 배치로 IN-query 1회씩, 총 4~5회 쿼리로 완결.
> `AsyncSession`은 Repository에만 보유, Service는 repo만 주입받음 (기존 패턴 유지).

### 4.4 "정확한 query_text 매칭" 정책

`TopQueriesTable`이 보여주는 `query_text`는 `GROUP BY query_text`의 결과이므로 **완전 일치**로 조회한다.
사용자 메시지 `session_messages.content`와 정확히 같은 값만 발생으로 본다.

> **경계 조건**: `search_events.query_text`와 `session_messages.content`가 다를 수 있다면 (예: 재작성 쿼리와 원본 구분) `session_messages.content` 기준으로 JOIN한다. 현재 구현에서 Top 10은 `search_events.query_text`로 그룹핑하므로 **양쪽을 `query_text`로 일치시켜** 혼동을 방지한다 — 즉 `WHERE search_events.query_text = :q`를 1차 필터로 사용.

---

## 5. UI 설계

### 5.1 모달 컨테이너

- 라이브러리: `@base-ui/react/dialog` (기존 `duplicate-confirm-dialog.tsx` 패턴)
- 크기: `max-w-3xl`, `max-h-[85vh]`, 내부 `overflow-y-auto`
- 닫기: 우상단 × 버튼 + Esc + 백드롭 클릭

### 5.2 레이아웃

```
┌─────────────────────────────────────────────────┐
│ [질문 텍스트 — 2줄까지 표시, 초과 시 말줄임]  [×] │
│ 총 N건 · 최근 30일                               │
├─────────────────────────────────────────────────┤
│ ▼ #1  [봇 Badge]  2026-04-21 18:55  [피드백 ✓] │
│   재작성: "..."               (있을 때만)        │
│   검색: tier 0 · 5건 · 342ms                    │
│   ─────────────────────────                     │
│   답변                                           │
│   [content, whitespace-pre-wrap]                │
│   ─────────────────────────                     │
│   매칭 출처 (5건)                                │
│   ┌ ① [A 뱃지] 권1 · 제3장 · score 0.87         │
│   │   "원문 스니펫..."                           │
│   ├ ② [B 뱃지] 권2 · score 0.81                 │
│   │   "원문 스니펫..."                           │
│   └ ...                                          │
│   ─────────────────────────                     │
│   피드백 · inaccurate                           │
│   "답이 이상해요" · 2026-04-21 18:57            │
│                                                 │
│ ▶ #2  [봇 Badge]  2026-04-20 14:22  [✗]        │
│ ▶ #3  ...                                       │
└─────────────────────────────────────────────────┘
```

- **기본 펼침 규칙**: 1번째 발생만 펼침, 나머지는 접힘
- **아코디언 헤더**: `#N · 봇명 · 시간 · 피드백 아이콘(👍/👎/-)` → 한눈에 비교 가능
- 답변 본문 길이 > 800자일 때 "더보기"/"접기" 토글
- 출처는 최대 10건까지 기본 표시, 초과 시 "+N건 더보기"

### 5.3 상태 & 에지 케이스

| 상태                   | 표시 방식                                              |
|------------------------|--------------------------------------------------------|
| 로딩                   | 모달 본문에 스켈레톤 3개                               |
| 네트워크 에러          | 에러 메시지 + "다시 시도" 버튼                         |
| `occurrences.length=0` | "최근 30일 내 발생이 없습니다" 플레이스홀더            |
| `answer_text=null`     | "답변이 저장되지 않았습니다" (회색 안내)               |
| `citations` 빈 배열    | "매칭된 출처가 없습니다"                               |
| `chatbot_name=null`    | "(삭제된 봇)" 뱃지                                     |
| `feedback=null`        | 피드백 섹션 자체를 렌더링 안 함                        |
| `total_count > limit`  | 상단 요약에 "상위 50건만 표시 (전체 N건)" 명시         |

### 5.4 접근성

- 모달 오픈 시 첫 번째 아코디언 헤더에 포커스
- Esc/× 버튼으로 닫기
- 아코디언 헤더는 `<button>` 요소, Enter/Space 토글
- `aria-expanded`, `aria-controls` 정확히 바인딩

---

## 6. 구현 파일 단위

### 6.1 Backend

| 파일                               | 변경 유형 | 내용                                                         |
|------------------------------------|-----------|--------------------------------------------------------------|
| `admin/analytics_schemas.py`       | 수정      | `CitationItem`, `FeedbackItem`, `QueryOccurrence`, `QueryDetailResponse` 추가 |
| `admin/analytics_repository.py`    | 수정      | `get_query_details(query_text, days, limit) -> dict` 추가    |
| `admin/analytics_router.py`        | 수정      | `GET /search/query-details` 엔드포인트 추가. 기존 `get_top_queries` 패턴대로 Repository를 직접 주입받아 호출 (별도 service layer 신설 없음) |
| `tests/test_analytics_router.py`   | 수정      | `test_get_query_details_*` 케이스 추가                       |

### 6.2 Frontend

| 파일                                                                 | 변경 유형 | 내용                                                 |
|----------------------------------------------------------------------|-----------|------------------------------------------------------|
| `features/analytics/types.ts`                                        | 수정      | `QueryDetail`, `QueryOccurrence`, `CitationItem` 등  |
| `features/analytics/api.ts`                                          | 수정      | `getQueryDetails(queryText, days)` 추가              |
| `features/analytics/components/query-detail-modal.tsx`               | 신규      | 모달 컴포넌트 본체                                   |
| `features/analytics/components/query-detail-occurrence.tsx`          | 신규      | 단일 발생 아코디언 아이템 (큰 파일 분리 위함)        |
| `app/(dashboard)/analytics/page.tsx`                                 | 수정      | `TopQueriesTable` 행 클릭 핸들러 + 모달 상태 관리    |
| `features/analytics/components/__tests__/query-detail-modal.test.tsx`| 신규      | Vitest 테스트                                        |

### 6.3 마이그레이션

- **없음**. 스키마 변경 없이 기존 테이블만 조회.

---

## 7. 테스트 전략

### 7.1 Backend (`pytest`)

- `test_get_query_details_returns_occurrences_desc` — 기본 happy path
- `test_get_query_details_includes_citations_and_feedback` — 관계 매핑 검증
- `test_get_query_details_answer_text_null_when_no_assistant` — 답변 없음 케이스
- `test_get_query_details_chatbot_name_null_when_deleted` — 봇 삭제 케이스
- `test_get_query_details_total_count_exceeds_limit` — limit 초과 시 total_count 노출
- `test_get_query_details_empty_when_no_match` — 빈 결과
- `test_get_query_details_respects_days_window` — 기간 필터링
- `test_get_query_details_requires_admin_auth` — 401 케이스

### 7.2 Frontend (`vitest`)

- `query-detail-modal.test.tsx`
  - 로딩 스켈레톤 렌더
  - 발생 0건 플레이스홀더
  - 첫 번째 아코디언이 기본 펼침
  - 피드백 없는 발생에서 피드백 섹션 미노출
  - 답변 null일 때 안내 문구
  - `total_count > returned_count`일 때 경고 문구

### 7.3 E2E (Playwright — 선택)

- 검색 분석 페이지 → Top 10 행 클릭 → 모달 오픈 → 아코디언 펼침 → 출처 노출 확인

---

## 8. 성능 고려

- 모달은 **open 시에만** 쿼리 시작 (`useQuery` `enabled: !!selectedQuery`)
- 결과 캐싱: React Query 기본 `staleTime: 30_000`, 같은 질문 다시 열면 캐시에서 즉시 노출
- 백엔드 4~5회 쿼리 — `search_events`는 `created_at` 인덱스, `session_messages`·`answer_citations`는 `message_id` 인덱스 존재 (기존)
- `answer_text`는 길 수 있으나 단일 발생당 1건, `limit=50` 기준 최대 50개 → 응답 크기 수백 KB 이내

---

## 9. 보안 & 관찰성

- 기존 analytics 라우터와 동일하게 **admin JWT 쿠키 인증** 필수
- `query_text`는 쿼리 파라미터로 받지만 **SQL Injection 방지**: SQLAlchemy text 바인딩 파라미터 사용 (기존 `get_top_queries` 패턴 유지)
- 감사 로그(`AdminAuditLog`)는 **남기지 않음** — 읽기 전용 분석 조회이고 기존 analytics 엔드포인트도 남기지 않는 관행을 따름

---

## 10. 마이그레이션·롤아웃

- **DB 마이그레이션 없음**
- **기능 플래그 없음**: 순수 추가 기능, 리스크 낮음
- 배포 순서: Backend 엔드포인트 먼저 → Frontend 모달 배포
- 롤백: Frontend 배포 롤백으로 즉시 비활성화 가능

---

## 11. 오픈 질문 (구현 중 결정)

- `search_events.query_text`와 `session_messages.content`가 달라지는 케이스가 존재하는지 → 구현 시 실제 데이터로 확인 후 필요시 쿼리 전략 보정
- 봇 Badge의 색상은 `chatbot_configs` 메타에 있는지, 없다면 기본색 사용

---

## 12. 성공 기준

- [ ] 운영자가 인기 질문 Top 10 행을 클릭해 해당 질문의 모든 발생을 한 모달에서 확인할 수 있다
- [ ] 각 발생마다 봇명/시점/답변/매칭 출처/피드백을 읽을 수 있다
- [ ] 답변/출처/피드백 누락 케이스에서도 모달이 깨지지 않는다
- [ ] 모든 신규 pytest·vitest 테스트 통과
- [ ] 모달 오픈 → 첫 응답까지 500ms 이내 (로컬 환경, 발생 수 ≤ 10 기준)
