# 카테고리별 문서 매핑 현황 표시 — 설계 문서

> **작성일:** 2026-04-09
> **근거 문서:** `docs/01_requirements/18-category-document-stats.md`
> **상태:** 설계 승인 완료, 구현 대기

---

## 1. 목적

관리자가 카테고리 관리 탭에서 **각 카테고리에 어떤 문서가 몇 개의 청크로 저장되어 있는지** 한눈에 파악할 수 있게 한다. 현재는 문서 업로드 후 Qdrant에만 데이터가 존재하여 카테고리별 현황 확인 방법이 없다.

---

## 2. 설계 결정 요약

| 항목 | 결정 | 근거 |
|------|------|------|
| 데이터 소스 | 실시간 Qdrant 쿼리 | 현재 규모 수백~수천 건, 별도 집계 테이블 불필요 |
| Qdrant 쿼리 방식 | `count` + `scroll`을 `asyncio.gather`로 병렬 | 순차 대비 레이턴시 ~6배 개선, 코드 복잡도 미미 |
| 확장 행 정보 | volume 이름만 | MVP에서 충분, 청크 수/일시는 향후 확장 |
| 로딩 타이밍 | 탭 진입 시 자동 (staleTime 60초) | UX 마찰 없음, API 분리 유지 |
| 비활성 카테고리 | 통계 포함 표시 | Qdrant에 데이터 잔존 여부 확인 필요 |
| volume 정렬 | 알파벳순 | 관리자가 특정 문서 찾기 용이 |
| UI 디자인 | 구현 시 `ui-ux-pro-max` 스킬 사용 | 색상/디자인 디테일은 전문 스킬로 마무리 |

---

## 3. 백엔드 설계

### 3.1 응답 스키마

**파일:** `backend/src/datasource/schemas.py`

```python
class CategoryDocumentStats(BaseModel):
    source: str           # 카테고리 key ("A", "B" 등)
    total_chunks: int     # Qdrant 포인트 총 수
    volumes: list[str]    # 고유 volume 목록 (알파벳순 정렬)
    volume_count: int     # len(volumes) — 프론트 편의용
```

### 3.2 API 엔드포인트

**파일:** `backend/src/admin/data_router.py`

```
GET /admin/data-sources/category-stats
Authorization: JWT (Depends(get_current_admin))
Response: list[CategoryDocumentStats]
```

### 3.3 로직 흐름

```
1. DataSourceCategoryService.list_all() → 전체 카테고리 목록 (비활성 포함)

2. 카테고리별 2개 비동기 태스크 생성:
   a. client.count(
        collection_name=settings.collection_name,
        count_filter=Filter(must=[
          FieldCondition(key="source", match=MatchValue(value=key))
        ])
      )
      → 총 청크 수

   b. scroll 루프 (전체 포인트 순회):
      offset = None
      while True:
        points, offset = client.scroll(
          collection_name=settings.collection_name,
          scroll_filter=Filter(must=[
            FieldCondition(key="source", match=MatchValue(value=key))
          ]),
          with_payload=["volume"],
          with_vectors=False,
          limit=1000,
          offset=offset
        )
        volumes |= {p.payload["volume"] for p in points}
        if offset is None: break
      → 고유 volume 수집 (포인트 수와 무관하게 완전 순회)

3. asyncio.gather(*all_tasks) → 병렬 실행

4. 결과 조합:
   - scroll 결과에서 set()으로 고유 volume 추출
   - sorted()로 알파벳순 정렬
   - CategoryDocumentStats 리스트 구성 후 반환
```

### 3.4 성능 고려

- `source`, `volume` 필드에 이미 payload index 존재 (`qdrant_client.py:44-55`)
- `with_vectors=False` + `with_payload=["volume"]`로 네트워크 부하 최소화
- `count`는 인덱스만 읽어서 매우 빠름 (~1ms)
- 카테고리 6개 × 2회 = 12개 쿼리 병렬 → 전체 ~10ms 예상
- scroll 페이지네이션 루프로 포인트 수에 무관하게 모든 volume 수집 보장

---

## 4. 프론트엔드 설계

### 4.1 API 타입 & 클라이언트

**파일:** `admin/src/lib/api.ts`

```typescript
interface CategoryDocumentStats {
  source: string;
  total_chunks: number;
  volumes: string[];
  volume_count: number;
}

// dataSourceCategoryAPI 확장
getCategoryStats: () => fetchAPI<CategoryDocumentStats[]>(
  "/admin/data-sources/category-stats"
)
```

### 4.2 React Query 훅

**파일:** `admin/src/lib/hooks/use-data-source-categories.ts`

```typescript
export function useCategoryStats() {
  return useQuery({
    queryKey: ["category-stats"],
    queryFn: () => dataSourceCategoryAPI.getCategoryStats(),
    staleTime: 60_000,  // 60초 캐시
  });
}
```

### 4.3 캐시 무효화

**파일:** `admin/src/app/(dashboard)/data-sources/page.tsx`

업로드 성공 콜백에서 기존 invalidateQueries에 `["category-stats"]` 추가.

### 4.4 카테고리 탭 UI 변경

**파일:** `admin/src/app/(dashboard)/data-sources/category-tab.tsx`

#### 테이블 컬럼 변경

| 기존 | 변경 후 |
|------|---------|
| Key, 이름, 설명, 색상, 상태, 동작 | **(확장)**, Key, 이름, **문서/청크**, 색상, 상태, 동작 |

#### "문서/청크" 컬럼 표시 규칙

- 데이터 있음: `3 문서 · 1,245 청크` (숫자 bold, 단위 muted)
- 데이터 없음: `문서 없음` (muted 텍스트)
- 로딩 중: Skeleton 바

#### 확장/축소 행

- 첫 번째 컬럼에 `ChevronRight` / `ChevronDown` 아이콘
- 행 클릭 시 토글 (React state `expandedKeys: Set<string>`)
- volume 없는 카테고리: chevron 숨김, 클릭 불가
- 확장 시 서브 행:
  - 카테고리 색상 좌측 보더 (3px)
  - volume 이름을 칩(badge) 형태로 나열
  - flex-wrap으로 여러 줄 허용

#### 디자인 노트

구현 시 `ui-ux-pro-max` 스킬을 사용하여 색상/스타일 디테일 마무리할 것.

---

## 5. 수정 파일 목록

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `backend/src/datasource/schemas.py` | 수정 | `CategoryDocumentStats` 스키마 추가 |
| `backend/src/admin/data_router.py` | 수정 | `GET /category-stats` 엔드포인트 추가 |
| `admin/src/lib/api.ts` | 수정 | 타입 + `getCategoryStats()` 메서드 추가 |
| `admin/src/lib/hooks/use-data-source-categories.ts` | 수정 | `useCategoryStats()` 훅 추가 |
| `admin/src/app/(dashboard)/data-sources/category-tab.tsx` | 수정 | 테이블 확장 (chevron + 문서/청크 컬럼 + 확장 행) |
| `admin/src/app/(dashboard)/data-sources/page.tsx` | 수정 | 업로드 후 `["category-stats"]` 캐시 무효화 |

---

## 6. 검증 방법

1. **백엔드 API:** `GET /admin/data-sources/category-stats` 호출 → 카테고리별 chunks/volumes 정상 반환 확인
2. **문서/청크 표시:** 카테고리 탭에서 각 행의 문서 수·청크 수 표시 확인
3. **확장 행:** 행 클릭 시 volume 목록 확장/축소 동작 확인
4. **빈 카테고리:** 데이터 없는 카테고리에서 "문서 없음" + chevron 숨김 확인
5. **로딩 상태:** 느린 네트워크에서 Skeleton 표시 확인
6. **캐시 무효화:** 문서 업로드 후 카테고리 탭 통계 자동 업데이트 확인
7. **비활성 카테고리:** 비활성 카테고리에도 통계가 표시되는지 확인
