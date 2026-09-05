# 18. 카테고리별 문서 매핑 현황 표시 기능

> **상태:** 구현 대기
> **작성일:** 2026-04-09
> **관련:** 데이터 소스 관리, 카테고리 관리 탭

---

## 배경

현재 데이터 소스 페이지에서 문서를 업로드할 때 카테고리를 선택하지만, **업로드 후 어떤 문서가 어느 카테고리에 속하는지 확인할 방법이 없다.** 문서는 PostgreSQL이 아닌 Qdrant에 청크 단위로 저장되며, `source` 필드가 카테고리 key와 매핑된다. 이 기능을 통해 관리자가 카테고리별 데이터 현황을 한눈에 파악할 수 있게 한다.

---

## 설계 방향

기존 **카테고리 관리 탭을 확장**한다 (새 탭 추가 X). "이 카테고리에 뭐가 들어있지?"를 확인하는 가장 자연스러운 위치이기 때문.

---

## 구현 계획

### Step 1: 백엔드 — 응답 스키마 추가

**파일:** `backend/src/datasource/schemas.py`

```python
class CategoryDocumentStats(BaseModel):
    source: str              # 카테고리 key (e.g. "A")
    total_chunks: int        # Qdrant 포인트 총 수
    volumes: list[str]       # 고유 volume(문서) 목록
    volume_count: int        # 문서 수
```

### Step 2: 백엔드 — API 엔드포인트 추가

**파일:** `backend/src/admin/data_router.py`

- **엔드포인트:** `GET /admin/data-sources/category-stats`
- **인증:** `Depends(get_current_admin)`
- **로직:**
  1. `DataSourceCategoryService.list_active()`로 활성 카테고리 목록 조회
  2. 카테고리별로 Qdrant 쿼리:
     - `client.count(filter=source)` → 총 청크 수
     - `client.scroll(filter=source, with_payload=["volume"], with_vectors=False)` → 고유 volume 수집
  3. 결과 집계 후 반환

- **사용할 클라이언트:** `get_async_client()` (비동기, `qdrant_client.py:15`)
- **성능:** `source`, `volume` 필드에 이미 payload index 존재 (`qdrant_client.py:44-55`)

### Step 3: 프론트엔드 — API 타입 & 클라이언트 추가

**파일:** `admin/src/lib/api.ts`

- `CategoryDocumentStats` 인터페이스 추가
- `dataAPI`에 `getCategoryStats()` 메서드 추가

### Step 4: 프론트엔드 — React Query 훅 추가

**파일:** `admin/src/lib/hooks/use-data-source-categories.ts`

- `useCategoryStats()` 훅 추가 (staleTime: 60초)

### Step 5: 프론트엔드 — 카테고리 탭 UI 개선

**파일:** `admin/src/app/(dashboard)/data-sources/category-tab.tsx`

기존 카테고리 테이블을 확장:

1. **"문서/청크" 컬럼 추가** — 설명과 색상 사이
   - `3 문서 · 1,245 청크` 형태로 표시
   - 문서 없으면 `문서 없음` (muted 텍스트)
   - 로딩 중에는 Skeleton 표시

2. **행 클릭 시 확장/축소** — 카테고리에 속한 volume 목록 표시
   - `ChevronRight` / `ChevronDown` 아이콘으로 토글
   - 확장 시 서브 행에 volume 이름 리스트 (카테고리 색상 좌측 보더)
   - volume 없으면 확장 불가 (chevron 숨김)

3. **UI/UX 가이드라인 준수:**
   - 터치 타겟 44px+ (chevron 버튼)
   - 로딩 상태 skeleton
   - 빈 상태 안내 텍스트
   - 카테고리 색상 시각적 활용

### Step 6: 업로드 후 캐시 무효화

**파일:** `admin/src/app/(dashboard)/data-sources/page.tsx`

- 업로드 성공 후 `["category-stats"]` 쿼리 캐시도 무효화

---

## 수정 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `backend/src/datasource/schemas.py` | `CategoryDocumentStats` 스키마 추가 |
| `backend/src/admin/data_router.py` | `GET /category-stats` 엔드포인트 추가 |
| `admin/src/lib/api.ts` | 타입 + API 메서드 추가 |
| `admin/src/lib/hooks/use-data-source-categories.ts` | `useCategoryStats()` 훅 추가 |
| `admin/src/app/(dashboard)/data-sources/category-tab.tsx` | 테이블 확장 (문서 컬럼 + 확장 행) |
| `admin/src/app/(dashboard)/data-sources/page.tsx` | 캐시 무효화 추가 |

---

## 검증 방법

1. 백엔드: `GET /admin/data-sources/category-stats` 호출 → 카테고리별 chunks/volumes 반환 확인
2. 프론트엔드: 카테고리 탭에서 문서/청크 수 표시 확인
3. 행 클릭 시 volume 목록 확장/축소 동작 확인
4. 문서 업로드 후 카테고리 탭 새로고침 시 수치 업데이트 확인
5. 빈 카테고리, 로딩 상태 등 엣지 케이스 확인
