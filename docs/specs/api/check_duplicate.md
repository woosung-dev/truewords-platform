# 업로드 전 중복 문서 확인 API

> 추가일: 2026-04-14
> 관련 엔드포인트: `GET /admin/data-sources/check-duplicate`

---

## 배경

기존 업로드 파이프라인은 동일 파일명(NFC 정규화 기준)이 재업로드되면 **경고 없이 기존 데이터를 UPSERT/덮어쓰기** 한다.

- `ingestion_jobs.volume_key` UNIQUE 제약 → PostgreSQL row 상태 초기화
- Qdrant `point_id = uuid5(NAMESPACE_URL, "{volume}:{chunk_index}")` → 기존 포인트 덮어쓰기
- `source` 필드(기존 카테고리 태그)가 그대로 교체됨 → 기존 분류 소실

운영 중 "말씀선집 002" 문서가 한 번은 `말씀선집` 분류로, 다른 한 번은 "미분류"로 혼재된 사례가 확인됨(NFC/NFD 혼재 가설 포함). 실수로 인한 분류 손실을 방지하기 위한 UX 보강이 필요하다.

---

## 엔드포인트 명세

### 요청

```
GET /admin/data-sources/check-duplicate?filename={filename}
Authorization: HttpOnly Cookie (admin JWT)
```

- `filename` (string, required): 업로드하려는 파일명. 서버가 `Path(filename).name`으로 경로 컴포넌트를 제거한 뒤 `unicodedata.normalize("NFC", ...)` 로 정규화한다.

### 응답 (200 OK)

```json
{
  "exists": true,
  "volume_key": "말씀선집 002.pdf",
  "filename": "말씀선집 002.pdf",
  "sources": ["말씀선집"],
  "chunk_count": 237,
  "status": "completed",
  "last_uploaded_at": "2026-04-10T12:34:56.000000"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `exists` | boolean | IngestionJob row 또는 Qdrant 포인트가 1개라도 있으면 true |
| `volume_key` | string | NFC 정규화된 volume 키 (UI에서 "태그만 추가" 액션의 volume 인자로 사용) |
| `filename` | string | 기존 저장 시의 원본 파일명 (없으면 전달된 파일명) |
| `sources` | string[] | 기존 문서의 카테고리 태그 (빈 배열이면 미분류) |
| `chunk_count` | number | Qdrant에 적재된 청크 수. NFC/NFD 양쪽 volume을 합산 |
| `status` | string\|null | IngestionJob 최종 상태 (`completed` / `partial` / `failed` / `running` / `pending`) |
| `last_uploaded_at` | string\|null | ISO-8601, IngestionJob `updated_at` |

### 오류

- `400`: `filename` 누락/공백
- `401`: 미인증

---

## 프론트 사용 패턴

업로드 직전 이 API를 호출하여 기존 문서 존재 여부를 확인하고, 존재 시 `DuplicateConfirmDialog`로 3가지 옵션을 제공한다.

| 사용자 선택 | 동작 |
|---|---|
| **덮어쓰고 다시 업로드** | 기존 `POST /admin/data-sources/upload` 호출 (기존 동작 유지) |
| **기존 문서에 "{source}" 태그만 추가** | `PUT /admin/data-sources/volume-tags { volume: volume_key, source }` 호출. 파일은 업로드하지 않음. `sources`에 이미 포함된 태그면 버튼 숨김. |
| **취소** | 대기 상태 유지, 사용자가 다시 업로드 버튼을 누를 수 있도록 둠 |

관련 구현:
- Backend: `backend/src/admin/data_router.py:get_ingest_status` 다음 라우트
- Service: `backend/src/pipeline/ingestion_service.py:IngestionJobService.find_by_filename`
- Qdrant: `backend/src/datasource/qdrant_service.py:get_volume_snapshot`
- Frontend: `admin/src/features/data-source/components/duplicate-confirm-dialog.tsx`
