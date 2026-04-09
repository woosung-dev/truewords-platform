# 카테고리 태그 관리 UI — Transfer 패턴 설계

> **작성일:** 2026-04-09
> **상태:** 승인됨
> **선행 작업:** 다중 카테고리 태깅 백엔드 (완료), category-stats API (완료)
> **관련 문서:** `docs/01_requirements/19-category-tag-management-ui.md`

---

## 1. 개요

### 배경

다중 카테고리 태깅 백엔드가 완료되었지만 현재 UI에 사용성 문제가 있다:

- 하단 드롭다운이 전체 문서를 일괄 추가 — 개별 문서 선택 불가
- 현재 카테고리 태그만 표시 — 문서가 다른 카테고리에도 속해있는지 확인 불가
- 업로드 시 카테고리 1개 필수 — 나중에 변경하려면 제거 후 재추가

### 목표

1. Transfer 패턴으로 개별 문서 단위의 카테고리 관리 UI 제공
2. 업로드와 분류를 분리하여 유연한 워크플로우 지원
3. 미분류 문서를 시각적으로 인지하고 처리할 수 있는 경로 제공

---

## 2. 설계 결정 요약

| 항목 | 결정 | 이유 |
|------|------|------|
| Transfer 진입점 | Actions 열 "문서 관리" 버튼 → Sheet | 발견하기 쉽고 Sheet가 충분한 공간 제공 |
| Sheet 내부 패턴 | 클래식 Transfer (좌/우 패널 + 중앙 화살표) | 다중 선택 + 일괄 이동 지원, 검증된 UX 패턴 |
| 반응형 | 데스크톱: 좌/우 패널 · 모바일: 탭 전환 | 기존 admin의 sm: 브레이크포인트 패턴 활용 |
| 저장 방식 | 일괄 저장 (batch) | 다량 이동 시 안정적, 취소로 실수 방지 |
| 미분류 문서 | 카테고리 테이블에 가상 "미분류" 행 | 기존 테이블 패턴과 동일, 학습 비용 없음 |
| 전체 volume 데이터 | 새 API `GET /admin/data-sources/volumes` | 미분류 문서(source=[]) 포함하려면 Qdrant 직접 조회 필요 |
| 업로드 워크플로우 | source 선택을 optional로 변경 | 업로드와 분류를 분리, 두 경로 모두 지원 |
| 전체 선택 | 패널 헤더에 전체 선택 체크박스 | 대량 문서 일괄 이동에 필수 |

---

## 3. 새 API: `GET /admin/data-sources/volumes`

### 응답 스키마

```python
class VolumeInfo(BaseModel):
    volume: str          # 문서(volume) 이름
    sources: list[str]   # 속한 카테고리 key 배열 (빈 배열 = 미분류)
    chunk_count: int     # 청크 수
```

```
GET /admin/data-sources/volumes → list[VolumeInfo]
```

### 구현 방식

- Qdrant 전체 1회 스캔 (`category-stats`와 동일한 scroll 패턴)
- source별이 아닌 **volume별** 그룹핑
- 미분류 문서(source=[] 또는 source가 빈 문자열) 포함
- macOS NFD 유니코드 정규화 적용

### 프론트엔드 훅

```typescript
// lib/api.ts
getAllVolumes(): Promise<VolumeInfo[]>
// GET /admin/data-sources/volumes

// hooks/use-data-source-categories.ts
useAllVolumes()
// Query key: ["all-volumes"]
// Stale time: 60초
// Transfer Sheet 열릴 때 fetch
```

---

## 4. Transfer Sheet UI 상세

### 4.1 진입점

카테고리 테이블 Actions 열에 "문서 관리" 아이콘 버튼 추가 (편집, 비활성화 버튼 옆).

클릭 시 Sheet(사이드 패널) 열림. Sheet 헤더에 카테고리 키 배지 + 이름 표시.

### 4.2 데스크톱 레이아웃 (≥ 640px)

```
┌──────────────────────────────────────────────────────┐
│ [L] 원리강론 — 문서 관리                          [✕] │
├──────────────────────────────────────────────────────┤
│                                                      │
│ ┌──────────────────┐       ┌──────────────────┐      │
│ │ ☐ 미포함 문서  2/12│       │ ☐ 포함된 문서   3│      │
│ │ 🔍 검색...        │       │ 🔍 검색...        │      │
│ │ ☐ 천성경    (128) │  [▶]  │ ☐ 원리강론  (456)│      │
│ │ ☑ 평화경     (89) │  [◀]  │ ☐ 원리흑백  (423)│      │
│ │ ☑ 말씀선집1 (256) │       │ ☐ 원리원본  (201)│      │
│ │ ☐ 말씀선집2 (198) │       │                   │      │
│ └──────────────────┘       └──────────────────┘      │
│                                                      │
│ ⚠️ 변경 예정: +2건 추가 (평화경.txt, 말씀선집1.txt)   │
│                                                      │
│                              [취소]  [저장 (2건 추가)] │
└──────────────────────────────────────────────────────┘
```

### 4.3 모바일 레이아웃 (< 640px)

```
┌──────────────────────────┐
│ [L] 원리강론          [✕] │
├──────────────────────────┤
│ [■ 미포함 (12)] [포함 (3)]│  ← 탭 전환
│                          │
│ ☐ 전체 선택        2/12  │
│ 🔍 검색...                │
│ ┌──────────────────────┐ │
│ │ ☐ 천성경.docx        │ │
│ │ ☑ 평화경.txt         │ │
│ │ ☑ 말씀선집1.txt      │ │
│ │ ☐ 말씀선집2.txt      │ │
│ └──────────────────────┘ │
│                          │
│ [  선택 항목 추가 ▶ (2건) ]│
│                          │
│           [취소]  [저장]  │
└──────────────────────────┘
```

- Tailwind `sm:` 브레이크포인트로 CSS만으로 전환
- "미포함" 탭에서는 "추가 ▶" 버튼, "포함" 탭에서는 "◀ 제거" 버튼 표시

### 4.4 패널 인터랙션

| 기능 | 동작 |
|------|------|
| 개별 체크박스 | 문서 하나 선택/해제 |
| 헤더 전체 선택 | 현재 **검색 결과 내** 전체 선택/해제 |
| 검색 | 문서명 부분 일치 필터링 (대소문자 무시) |
| ▶ 버튼 | 좌측에서 선택된 문서를 우측으로 이동 (로컬 state) |
| ◀ 버튼 | 우측에서 선택된 문서를 좌측으로 이동 (로컬 state) |
| 선택 카운트 | "2/12 선택" 형태로 헤더에 표시 |
| 변경 요약 | 하단 배너에 추가/제거 건수 표시 |

### 4.5 청크 수 표시

각 문서 옆에 `(N청크)` 형태로 청크 수 표시. 관리자가 문서의 규모를 인지할 수 있도록 한다. VolumeInfo의 `chunk_count` 필드 활용.

---

## 5. 미분류 가상 카테고리 행

### 표시 조건

- `GET /admin/data-sources/volumes` 응답에서 `sources` 배열이 빈 문서가 1건 이상 존재할 때만 표시
- 0건이면 행 자체를 숨김

### 행 외형

- 테이블 하단에 점선 구분선(`border-top: 2px dashed`)으로 분리
- 배경: amber 계열 (`bg-amber-50`)
- Key: `—` (대시), 이름: "미분류 문서"
- 상태: `⚠ 미분류` (amber 색상)
- Actions: "분류하기 →" 버튼 (편집/비활성화 버튼 없음)

### Transfer Sheet 동작

"분류하기" 클릭 시 Transfer Sheet가 열리지만, 특정 카테고리가 아닌 **미분류 → 카테고리 배정** 모드:
- Sheet 상단에 **카테고리 선택 드롭다운** 표시 (활성 카테고리 목록)
- 카테고리 선택 후 일반 Transfer와 동일하게 동작:
  - 좌측: 미분류 문서 목록 (source=[])
  - 우측: 선택한 카테고리에 포함된 문서
  - ▶/◀ 버튼으로 이동, 일괄 저장
- 카테고리 미선택 상태에서는 ▶ 버튼 비활성화

---

## 6. 업로드 워크플로우 변경

### 현재 (Before)

- source 드롭다운: 활성 카테고리 목록만 표시
- 기본값: 첫 번째 카테고리 (`categories[0]?.key`)
- 카테고리 선택 필수

### 변경 후 (After)

- source 드롭다운: **"미분류 (선택 안함)"** 옵션 추가 (value: `""`)
- 기본값: `""` (미분류)
- 카테고리 선택 선택 사항 (optional)

### 백엔드 변경

- 업로드 API의 `source` 파라미터를 optional로 변경
- source가 빈 문자열(`""`)이거나 누락 시 → Qdrant에 `source: []` (빈 배열)로 저장
- 프론트 드롭다운 value `""` → 백엔드에서 `source` 파라미터가 빈 문자열이면 빈 배열로 처리
- 기존에 source 문자열로 저장하던 로직을 `source: [value]` 배열로 저장하도록 확인 (이미 배열 마이그레이션 완료)

---

## 7. 일괄 저장 로직

### 흐름

1. Sheet 열릴 때: `useAllVolumes()`로 전체 volume 목록 가져옴
2. 현재 카테고리에 포함된 volume을 **초기 상태**로 저장 (Set)
3. 사용자가 ▶/◀ 버튼으로 문서 이동 (로컬 state만 변경)
4. "저장" 클릭 시:
   - **diff 계산**: 초기 Set vs 현재 Set
   - 추가된 volume: `addVolumeTag` API 호출
   - 제거된 volume: `removeVolumeTag` API 호출
5. 순차 호출 + 프로그레스 표시 ("3건 중 2건 처리 중...")
6. 전체 성공 → toast("저장 완료") + Sheet 닫기 + 캐시 무효화
7. 부분 실패 → 에러 toast + Sheet 유지 (재시도 가능)

### 캐시 무효화 대상

- `["category-stats"]` — 카테고리별 volume 목록 갱신
- `["all-volumes"]` — 전체 volume 목록 갱신

### 에러 처리

- 네트워크 실패: toast에 실패한 volume명 표시, Sheet 유지
- 부분 성공: 성공한 건은 반영됨, 실패 건만 재시도 가능하도록 상태 유지

---

## 8. 수정 파일 목록

### 백엔드

| 파일 | 변경 |
|------|------|
| `backend/src/admin/data_router.py` | `GET /admin/data-sources/volumes` 엔드포인트 추가 |
| `backend/src/datasource/schemas.py` | `VolumeInfo` 스키마 추가 |
| `backend/src/admin/data_router.py` | 업로드 시 source optional 처리 확인 |

### 프론트엔드 (신규)

| 파일 | 설명 |
|------|------|
| `admin/src/components/ui/volume-transfer.tsx` | Transfer 컴포넌트 (좌/우 패널 + 검색 + 전체 선택 + 반응형) |
| `admin/src/components/ui/volume-transfer-sheet.tsx` | Sheet 래퍼 (열기/닫기 + 저장 로직 + diff 계산) |

### 프론트엔드 (수정)

| 파일 | 변경 |
|------|------|
| `admin/src/app/(dashboard)/data-sources/category-tab.tsx` | "문서 관리" 버튼 추가 + 미분류 가상 행 추가 + 기존 확장 행 태그 관리 UI 제거 |
| `admin/src/app/(dashboard)/data-sources/page.tsx` | source 드롭다운에 "미분류" 옵션 추가 + 기본값 변경 |
| `admin/src/lib/api.ts` | `getAllVolumes()` API 클라이언트 추가 |
| `admin/src/lib/hooks/use-data-source-categories.ts` | `useAllVolumes()` 훅 추가 |

---

## 9. 범위 외 (Out of Scope)

- 드래그 앤 드롭 문서 이동
- 문서 미리보기 (Transfer 내에서 문서 내용 확인)
- 카테고리 간 문서 일괄 복사 (Transfer는 한 카테고리에 대해서만 동작)
- 대량 데이터 가상 스크롤 (현재 문서 규모에서는 불필요, 추후 필요시 추가)
