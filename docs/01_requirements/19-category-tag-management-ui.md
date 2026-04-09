# 19. 카테고리 태그 관리 UI 개선

> **상태:** 구현 대기
> **작성일:** 2026-04-09
> **선행 작업:** 18-category-document-stats (완료), 다중 카테고리 태깅 백엔드 (완료)
> **관련:** 카테고리 관리 탭, 문서 태그 추가/제거 API

---

## 배경

다중 카테고리 태깅 백엔드가 완료되었지만, 현재 UI에 사용성 문제가 있다:

1. **하단 드롭다운이 전체 문서를 일괄 추가** — 개별 문서 선택 불가
2. **현재 카테고리 태그만 표시** — 문서가 다른 카테고리에도 속해있는지 확인 불가
3. **조작 단위가 모호** — 개별 문서 관리가 아닌 카테고리 단위 일괄 조작

---

## UI 참고: Transfer 패턴 (Ant Design)

Ant Design의 `Transfer` 컴포넌트가 좋은 참고 모델:

```
┌─────────────────────┐     ┌─────────────────────┐
│ ∨ 3 items           │     │ ∨ 10 items          │
│ ┌─────────────────┐ │     │ ┌─────────────────┐ │
│ │ 🔍 검색...       │ │     │ │ 🔍 검색...       │ │
│ └─────────────────┘ │     │ └─────────────────┘ │
│ ☐ content2          │ [>] │ ☐ content1          │
│ ☐ content12         │ [<] │ ☐ content3          │
│ ☐ content20         │     │ ☐ content5          │
└─────────────────────┘     └─────────────────────┘
  (미포함 문서)                (포함된 문서)
```

**핵심 특징:**
- 좌측: 아직 이 카테고리에 속하지 않은 문서 (전체 volume 풀)
- 우측: 이 카테고리에 속한 문서
- 중앙 화살표(>, <)로 선택한 문서를 추가/제거
- 상단 검색으로 문서 필터링 가능
- 체크박스로 다중 선택 지원

**antd는 사용하지 않음** — shadcn/ui 기반으로 Transfer 패턴을 직접 구현하거나, multi-select 방식으로 단순화.

---

## 설계 방향

### 옵션 A: Transfer 패턴 (Sheet/모달)

카테고리 행 클릭 또는 "문서 관리" 버튼 → Sheet/모달 열림:

```
┌──────────────────────────────────────────────────┐
│ 원리강론 (L) — 문서 관리                    [닫기] │
├──────────────────────────────────────────────────┤
│                                                  │
│  미포함 문서              포함된 문서              │
│ ┌──────────────┐       ┌──────────────┐          │
│ │ 🔍 검색       │       │ 🔍 검색       │          │
│ ├──────────────┤  [>]  ├──────────────┤          │
│ │ ☐ 천성경.docx │  [<]  │ ☑ 원리강론.txt│          │
│ │ ☐ 평화경.txt  │       │ ☐ 말씀선집.txt│          │
│ └──────────────┘       └──────────────┘          │
│                                                  │
│                              [저장]  [취소]       │
└──────────────────────────────────────────────────┘
```

- 장점: 한눈에 포함/미포함 파악, 다중 선택 후 일괄 이동
- 단점: 구현 복잡도 높음

### 옵션 B: Multi-Select 드롭다운 (인라인)

확장 행에서 각 문서별 multi-select 태그 편집:

```
포함된 문서
├─ 원리강론 유색(A5).txt  [L] [M] [+ 추가 ▾]
├─ 평화경.txt             [M]     [+ 추가 ▾]
└─ 천성경.docx            [M]     [+ 추가 ▾]
```

- 장점: 인라인으로 즉시 편집, 각 문서의 전체 태그 확인 가능
- 단점: 대량 문서 일괄 관리에 불편

### 추천: 옵션 A (Transfer 패턴)

카테고리에 문서가 수십~수백 개가 될 수 있으므로, 검색 + 다중 선택 + 일괄 이동이 가능한 Transfer 패턴이 적합.

---

## 구현 시 참고사항

### 기술 스택
- **UI 프레임워크:** shadcn/ui (antd 사용 안 함)
- **스킬:** 구현 시 `ui-ux-pro-max` 스킬 사용하여 디자인 마무리
- **백엔드 API:** 이미 완료됨
  - `PUT /admin/data-sources/volume-tags` — 태그 추가
  - `DELETE /admin/data-sources/volume-tags` — 태그 제거
  - `GET /admin/data-sources/category-stats` — 카테고리별 volume 목록

### 필요한 추가 API
- **전체 volume 목록 조회** — Transfer 좌측 패널용. 현재 category-stats에서 source별로만 제공.
  - 옵션 1: 새 엔드포인트 `GET /admin/data-sources/volumes` — 전체 고유 volume 목록 + 각 volume의 source 배열
  - 옵션 2: 프론트에서 모든 category-stats를 합쳐서 전체 volume 목록 구성

### NFD 정규화
- macOS 파일시스템 한글 NFD 이슈가 있음
- 태그 관리 API에 `unicodedata.normalize("NFD")` 적용 완료
- 새 API 추가 시에도 동일 적용 필요

### 현재 데이터 구조 (Qdrant payload)
```json
{
  "source": ["L", "M"],    // 배열 — 다중 카테고리 지원 완료
  "volume": "원리강론 유색(A5).txt",
  "text": "청크 본문...",
  "chunk_index": 0
}
```

---

## 수정 예상 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/src/admin/data_router.py` | (선택) 전체 volume 목록 API 추가 |
| `backend/src/datasource/schemas.py` | (선택) VolumeInfo 스키마 추가 |
| `admin/src/components/ui/transfer.tsx` | (신규) Transfer 컴포넌트 구현 |
| `admin/src/app/(dashboard)/data-sources/category-tab.tsx` | Transfer 연동 |
| `admin/src/lib/api.ts` | (선택) 전체 volume API 클라이언트 |
| `admin/src/lib/hooks/use-data-source-categories.ts` | (선택) useAllVolumes 훅 |
