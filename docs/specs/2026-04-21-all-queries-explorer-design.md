# 인기 질문 전체 탐색 페이지 설계

- **작성일:** 2026-04-21
- **대상:** Admin Dashboard 신규 페이지 `/analytics/queries`
- **선행:** PR #39 (인기 질문 상세 모달) 머지 완료 — 본 기능은 그 확장

---

## 1. 배경 & 목적

`/analytics`의 "인기 질문 Top 10" 카드는 최대 10개만 노출하고, 정렬·검색·필터 기능이 없다. 운영자가 **"Top 10 밖의 질문"**, **"특정 키워드 포함 질문"**, **"부정 피드백이 많은 질문"** 등을 찾으려면 DB 직접 조회 외엔 방법이 없다.

본 설계는 **전체 고유 질문 리스트를 검색/정렬/페이지네이션으로 탐색**할 수 있는 서브 페이지를 추가하여, 기존 Top 10의 한계를 확장한다. 행 클릭 시 기존 `QueryDetailModal`을 그대로 재사용한다.

---

## 2. 범위

### 포함
- 신규 페이지 `/analytics/queries` (Admin Dashboard 하위)
- 기존 `/analytics` Top 10 카드 헤더 우측에 `모두 보기 →` 링크 추가
- 신규 백엔드 엔드포인트 `GET /admin/analytics/search/queries` (페이지네이션, 검색, 정렬)
- 긴 텍스트 셀을 위한 `shadcn/ui Tooltip` 도입 + 범용 `TruncateTooltip` 래퍼 (신규 페이지 + 기존 Top 10 양쪽 적용)

### 제외 (YAGNI)
- 봇 필터, "부정 피드백만 보기" 체크박스
- CSV 내보내기
- 검색 하이라이트(ILIKE 매칭 구간 강조)
- 무한 스크롤
- 이벤트 타임라인 (개별 `search_events` 나열 — 별도 후속 기능으로 논의)
- 사이드바 메뉴 항목 추가 (nav-hierarchy 유지, Analytics 하위 뷰로만 진입)

---

## 3. 아키텍처 & 데이터 흐름

```
[/analytics 페이지의 "모두 보기" 링크 클릭]
  → Next.js router → /analytics/queries?days=30&sort=count_desc&page=1
  → 페이지 컴포넌트 mount → useQuery(getQueries({q, days, sort, page, size}))
  → GET /admin/analytics/search/queries?q=...&days=30&sort=count_desc&page=1&size=50
  → AnalyticsRepository.get_queries()
    ├ 총 고유 질문 수 (COUNT DISTINCT query_text)
    └ 페이지 항목들 (query_text, count, latest_at, negative_feedback_count)
  → QueryListResponse
  → 테이블 렌더 (TruncateTooltip 셀, 정렬 버튼, 페이지네이션)
  → 행 클릭 → 기존 QueryDetailModal (이미 구현됨, 그대로 재사용)
```

### 전체 구성 원칙
- 기존 `analytics` 도메인 패턴(router → repository, raw SQL via `text()`) 유지
- 신규 페이지는 `/analytics/queries/page.tsx`에 FSD 원칙으로 features 레이어와 분리

---

## 4. 백엔드 API 명세

### 4.1 엔드포인트
`GET /admin/analytics/search/queries`

**Query Parameters**

| 이름 | 타입 | 필수 | 기본 | 제약 | 설명 |
|---|---|---|---|---|---|
| `q` | string | ❌ | `""` | 0~500자 | 부분일치 검색 (대소문자 무시) |
| `days` | int | ❌ | 30 | 1~365 | 최근 N일 범위 |
| `sort` | enum | ❌ | `count_desc` | `count_desc` / `count_asc` / `recent_desc` / `recent_asc` | 정렬 기준 |
| `page` | int | ❌ | 1 | ≥ 1 | 1부터 시작 |
| `size` | int | ❌ | 50 | 1~100 | 페이지당 행 수 |

**인증**: 기존 analytics 라우터와 동일 `get_current_admin` 의존성

### 4.2 응답 스키마 (`analytics_schemas.py`)

```python
class QueryListItem(BaseModel):
    query_text: str
    count: int
    latest_at: datetime
    negative_feedback_count: int


class QueryListResponse(BaseModel):
    items: list[QueryListItem]
    total: int                  # 조건에 맞는 고유 질문 수
    page: int
    size: int
    days: int
```

### 4.3 쿼리 전략

**쿼리 1 — 총 고유 질문 수 (페이지네이션 메타)**
```sql
SELECT COUNT(DISTINCT query_text) AS total
FROM search_events
WHERE created_at >= :cutoff
  AND (:q = '' OR query_text ILIKE :q_pattern)
```

**쿼리 2 — 페이지 항목 (집계 + 피드백 COUNT)**
```sql
WITH agg AS (
    SELECT
        se.query_text,
        COUNT(*)::int AS count,
        MAX(se.created_at) AS latest_at,
        ARRAY_AGG(DISTINCT se.message_id) AS assistant_ids
    FROM search_events se
    WHERE se.created_at >= :cutoff
      AND (:q = '' OR se.query_text ILIKE :q_pattern)
    GROUP BY se.query_text
)
SELECT
    agg.query_text,
    agg.count,
    agg.latest_at,
    COALESCE(
        (SELECT COUNT(*) FROM answer_feedback af
         WHERE af.message_id = ANY(agg.assistant_ids)
           AND af.feedback_type != 'HELPFUL'),
        0
    )::int AS negative_feedback_count
FROM agg
ORDER BY
    CASE WHEN :sort = 'count_desc'  THEN agg.count END DESC,
    CASE WHEN :sort = 'count_asc'   THEN agg.count END ASC,
    CASE WHEN :sort = 'recent_desc' THEN agg.latest_at END DESC,
    CASE WHEN :sort = 'recent_asc'  THEN agg.latest_at END ASC,
    agg.query_text ASC
LIMIT :limit OFFSET :offset
```

> 주: `search_events.message_id` 는 assistant 메시지 id (PR #39에서 확인). `answer_feedback.message_id` 역시 assistant 기준. `HELPFUL`은 대문자(enum name 저장).

### 4.4 성능 / 경계
- 현재 데이터 볼륨 작음(월 단위 수백 건) — ILIKE 풀스캔 허용 범위
- 미래에 필요 시 `query_text`에 trigram GIN 인덱스 검토 (YAGNI, 본 작업 제외)
- 응답 크기: `size ≤ 100` × `query_text(~수백자)` → 수십 KB 이내

---

## 5. Frontend 설계

### 5.1 진입점
`admin/src/app/(dashboard)/analytics/page.tsx`의 `TopQueriesTable` 헤더 우측에:
```tsx
<Link href="/analytics/queries" className="text-xs text-primary hover:underline">
  모두 보기 →
</Link>
```

### 5.2 URL 상태
모든 필터·검색·정렬·페이지를 **query param**에 저장.

예: `/analytics/queries?q=천일국&days=30&sort=recent_desc&page=2`

- React Query key에 query param 그대로 포함 → 파라미터 바뀔 때 자동 재조회
- 페이지네이션/정렬 버튼은 URL을 업데이트하는 방식 (`router.push` 또는 `Link`)

### 5.3 페이지 레이아웃

```
┌─ 검색 분석 › 질문 탐색 ────────────────────────────────┐
│                                                         │
│ [🔍 질문 검색________________]                          │
│ 기간: 최근 30일 ▾     정렬: 횟수 ↓ ▾                    │
│                                                         │
│ ┌────────────────────────────────────────────────────┐│
│ │ 순위 │ 질문                  │ 횟수 │ 👎 │ 최근 발생 ││
│ ├──────┼───────────────────────┼──────┼────┼───────────┤│
│ │  1   │ 36가정 축복 받은…     │  3   │  1 │04-17 12:34││
│ │  2   │ 노조와 사조직         │  2   │  0 │04-17 01:03││
│ │  ⋮   │ ⋮                      │  ⋮   │ ⋮  │ ⋮         ││
│ └────────────────────────────────────────────────────┘│
│                                                         │
│ 총 124건 · 50개/페이지            ← 1 2 3 … →          │
└─────────────────────────────────────────────────────────┘
```

**상세 규칙**:
- 페이지 제목 "질문 탐색" + breadcrumb "검색 분석 › 질문 탐색"
- 검색 입력: `debounce 300ms`로 URL 업데이트
- 기간 셀렉트: 7 / 30 / 90 / 365일
- 정렬 셀렉트: 횟수 ↓ / 횟수 ↑ / 최근 발생 ↓ / 최근 발생 ↑
- 질문 컬럼: `TruncateTooltip`으로 말줄임 + 호버/탭 툴팁
- 행 전체 클릭 → 기존 `QueryDetailModal` 오픈 (해당 `query_text` 인자)
- 빈 결과: "조건에 맞는 질문이 없습니다"
- 로딩: 스켈레톤 10행
- 에러: 토스트 + "다시 시도" 버튼

### 5.4 `TruncateTooltip` 범용 컴포넌트

```tsx
// admin/src/features/analytics/components/truncate-tooltip.tsx
"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";

interface Props {
  text: string;
  className?: string;
  maxWidth?: string;   // e.g. "max-w-md"
}

export function TruncateTooltip({ text, className = "", maxWidth = "max-w-md" }: Props) {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setIsTouchDevice(window.matchMedia("(hover: none)").matches);
  }, []);

  // 데스크톱: hover/focus 기본, 모바일: click 시 open toggle
  return (
    <Tooltip open={isTouchDevice ? open : undefined} onOpenChange={setOpen}>
      <TooltipTrigger
        className={`block truncate cursor-help text-left ${className}`}
        onClick={() => isTouchDevice && setOpen((o) => !o)}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent className={`${maxWidth} whitespace-pre-wrap break-words`}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
```

### 5.5 기존 Top 10 테이블 Tooltip 교체
`admin/src/app/(dashboard)/analytics/page.tsx`의 질문 셀에서 `<span title={...}>` → `<TruncateTooltip text={...} />`로 교체. 기존 `title=` 속성 제거.

---

## 6. 파일 구조

### Backend
| 파일 | 유형 | 책임 |
|---|---|---|
| `backend/src/admin/analytics_schemas.py` | 수정 | `QueryListItem`, `QueryListResponse` 추가 |
| `backend/src/admin/analytics_repository.py` | 수정 | `get_queries(q, days, sort, page, size) -> dict` 추가 |
| `backend/src/admin/analytics_router.py` | 수정 | `GET /admin/analytics/search/queries` 엔드포인트 추가 |
| `backend/tests/test_analytics_queries.py` | 신규 | 통합 테스트 (인증/정렬/검색/페이지네이션/빈 결과) |

### Frontend
| 파일 | 유형 | 책임 |
|---|---|---|
| `admin/src/components/ui/tooltip.tsx` | 신규 | `pnpm dlx shadcn@latest add tooltip` 으로 생성 |
| `admin/src/features/analytics/types.ts` | 수정 | `QueryListItem`, `QueryListResponse`, `QuerySortKey` 추가 |
| `admin/src/features/analytics/api.ts` | 수정 | `getQueries({q, days, sort, page, size})` 추가 |
| `admin/src/features/analytics/components/truncate-tooltip.tsx` | 신규 | 범용 말줄임+툴팁 래퍼 (모바일 tap-to-toggle) |
| `admin/src/app/(dashboard)/analytics/page.tsx` | 수정 | Top 10 카드 헤더 "모두 보기" 링크 + 질문 셀 `TruncateTooltip` 교체 |
| `admin/src/app/(dashboard)/analytics/queries/page.tsx` | 신규 | 질문 탐색 페이지 본체 |
| `admin/src/test/queries-page.test.tsx` | 신규 | vitest (렌더/검색/정렬/페이지 전환/모달 연동) |

### Migration
- **없음.** 기존 테이블만 조회.

---

## 7. 테스트 전략

### Backend (pytest)
- `test_queries_returns_empty_when_no_match` — 빈 결과 응답
- `test_queries_returns_items_sorted_by_count_desc` — 기본 정렬 확인
- `test_queries_respects_sort_recent_desc` — 다른 정렬 키
- `test_queries_applies_ilike_search` — 부분일치 검색
- `test_queries_paginates_with_size_and_page` — 페이지네이션
- `test_queries_includes_negative_feedback_count` — 부정 피드백 COUNT 확인
- `test_queries_requires_admin_auth` — 401 반환

### Frontend (vitest)
- `queries-page.test.tsx`
  - 로딩 시 스켈레톤 렌더
  - 빈 결과 플레이스홀더
  - 검색 입력 debounce → 쿼리 파라미터 업데이트
  - 정렬 변경 → URL 업데이트 + 재조회
  - 행 클릭 시 `QueryDetailModal` open
  - 페이지 이동 시 URL page 업데이트

### Smoke (Playwright MCP)
- 배포 후 실제 Neon DB 대상 `/analytics/queries` 진입 → 검색/정렬/모달까지 검증

---

## 8. 성능 · 보안 · 관찰성

- **인증**: 기존 admin JWT 쿠키 필수 (`get_current_admin`)
- **SQL injection 방지**: 모든 파라미터 바인딩 (`:q_pattern` 등)
- **Rate limit**: 기존 analytics 라우터와 동일, 별도 제한 없음
- **로깅**: 기존 구조 그대로

---

## 9. 롤아웃
1. Backend 엔드포인트 먼저 배포 (프론트 없이도 curl 가능)
2. Frontend 페이지 + Top 10 링크 배포
3. 브라우저 검증 후 완료

롤백: Frontend 롤백으로 즉시 무력화.

---

## 10. 성공 기준

- [ ] `/analytics/queries`에서 모든 고유 질문을 페이지네이션으로 탐색 가능
- [ ] 텍스트 부분검색(ILIKE)이 동작
- [ ] 4가지 정렬 옵션 동작
- [ ] 각 행 클릭 시 기존 `QueryDetailModal` 그대로 오픈
- [ ] 긴 질문 셀이 말줄임 + 호버 툴팁으로 전체 노출(데스크톱), 모바일은 탭 toggle
- [ ] Top 10 테이블 질문 셀도 동일 Tooltip으로 교체
- [ ] pytest/vitest 신규 테스트 통과, 기존 회귀 없음
