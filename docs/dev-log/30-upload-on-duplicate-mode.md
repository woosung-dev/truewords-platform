# ADR-30 — 업로드 재업로드 정책 `on_duplicate` 도입 (merge | replace | skip)

- 상태: Accepted
- 결정일: 2026-04-27
- 관련 PR: feat/upload-on-duplicate-mode
- 결정자: woosung

---

## 1. Context

### 1.1 발견된 UX 결함

운영자가 동일 파일(`말씀선집_xxx.pdf`)을 두 번 업로드하면서 다음 흐름을 시도했다.

1. 처음에 `source=""`(미분류)로 업로드 → Qdrant payload `source=[""]`
2. Admin UI에서 카테고리 이동(`PUT /admin/data-sources/volume-tags`) → `source=["A"]` (말씀선집)
3. 같은 파일을 다시 `source=""`(미분류)로 업로드

운영자는 (3)에서 **기존 카테고리(`["A"]`)가 보존된 채 콘텐츠만 갱신**되기를 기대했다.
실제 동작은 다음과 같다.

- Point ID(`uuid5(volume:chunk_index)`)는 deterministic이라 **벡터/청크 자체는 같은 자리에 덮어써짐**
- 그러나 `payload.source`는 새 업로드 값(`[""]`)으로 **통째로 교체** → 기존 `["A"]` 태그 손실

이는 운영자에게 "이식되지 않고 새로 들어간 것처럼" 보이는 silent data loss 패턴이다.

### 1.2 현재 코드 위치

| 동작 | 위치 |
|------|------|
| Point ID 생성 (deterministic) | `backend/src/pipeline/ingestor.py:169` |
| `payload.source` 새 값 교체 | `backend/src/pipeline/ingestor.py:170,185` |
| DB row 상태/source 리셋 | `backend/src/pipeline/ingestion_repository.py:20-47` `upsert_pending` |
| 사전 중복 검사 (이미 존재) | `backend/src/admin/data_router.py:331-365` `/check-duplicate` |
| 카테고리 union API (이미 존재) | `backend/src/datasource/qdrant_service.py:176-224` `add_volume_tag` |
| Admin UI 모달 (현재 overwrite/add-tag/cancel) | `admin/src/features/data-source/components/duplicate-confirm-dialog.tsx` |

### 1.3 업계 표준 조사

| 사례 | 패턴 |
|------|------|
| Pinecone (커뮤니티 권장) | Deterministic Vector ID + upsert |
| LlamaIndex `IngestionPipeline` | `DocstoreStrategy = DUPLICATES_ONLY \| UPSERTS \| UPSERTS_AND_DELETE` (정책 기반) |
| Qdrant 공식 | `upsert`(콘텐츠/벡터)와 `set_payload`(메타데이터)를 분리 |
| Open WebUI RAG | 충돌 시점에 명시적 사용자 선택 (update/skip) |
| Postgres / Kubernetes | "정책 기본값 + 명시적 옵트인 override" |

**결론**: "기본 안전 정책 + 명시적 옵트인" 패턴(LlamaIndex/Postgres 라인)이
다중 채널(Admin / 향후 Mobile / 자동화 스크립트) 다채널 시스템에 가장 적합하다.

---

## 2. Decision

`POST /admin/data-sources/upload` 엔드포인트에 `on_duplicate` 파라미터를 추가한다.

| 모드 | 기본값 | 동작 |
|------|--------|------|
| `merge` | ✅ default | 기존 `payload.source`를 보존하면서 새 source와 합집합. 임베딩/upsert는 새로 수행하여 콘텐츠 갱신은 반영. |
| `replace` |  | 현재 동작 유지. 새 source로 통째로 덮어쓰기 (의도적 분류 변경 시). |
| `skip` |  | 동일 파일이 이미 `COMPLETED` 상태면 임베딩/upsert를 모두 건너뜀. (LlamaIndex `DUPLICATES_ONLY` 사상) |

### 2.1 처리 매트릭스

```
                기존 미존재   기존 PENDING/RUNNING/PARTIAL   기존 COMPLETED
on_duplicate=merge    적재         이어서 적재(source ∪ 새 src)     재임베딩 + source ∪ 새 src
on_duplicate=replace  적재         이어서 적재(새 src만)             재임베딩 + 새 src만
on_duplicate=skip     적재         이어서 적재(새 src만)             완전 건너뜀(임베딩/upsert/DB 변경 X)
```

`PARTIAL`/`RUNNING`은 재개 의도가 명확하므로 `skip`이라도 이어서 적재한다 — 조기 종료 방지.

### 2.2 batch 모드(`mode=batch`) 처리

본 PR 범위 밖. `on_duplicate`는 `mode=standard`에서만 적용한다. batch에서는
무시되며 기존 동작(replace 동등)을 유지한다 — 후속 PR에서 정렬 예정.

### 2.3 DB(`IngestionJob.source`) 처리

`IngestionJob.source: str` 필드는 운영 표시용이다. 진실 원점은 Qdrant payload의 `source[]`.
복잡도를 줄이기 위해 모든 모드에서 **DB의 `source`는 마지막 업로드 시점 값으로 갱신**한다 (현재 동작 유지).
검색은 Qdrant payload만 보므로 운영 동작에 영향 없다.

### 2.4 Admin UI 변경

기존 `duplicate-confirm-dialog.tsx`의 결정값을 다음으로 정리한다.

```
DuplicateDecision = "merge" | "replace" | "add-tag" | "cancel"
```

- `merge` (신규, 기본 권장 버튼): `on_duplicate=merge`로 재업로드. 분류 보존 + 내용 갱신.
- `replace` (기존 `overwrite` 이름 변경): `on_duplicate=replace`로 재업로드.
- `add-tag` (기존): 임베딩 안 함. `volume-tags` API로 태그만 추가.
- `cancel` (기존): 업로드 중단.

일괄 업로드(여러 파일 동시 선택)는 모달 없이 기본 `merge`로 흘리고, 결과 토스트에 통계 표시.

---

## 3. Consequences

### 긍정

- **데이터 안전성**: 재업로드 시 기존 분류가 silent하게 손실되지 않는다.
- **업계 정합성**: LlamaIndex `DocstoreStrategy` + Qdrant `set_payload` 분리 사상과 일치.
- **확장성**: `skip` 모드가 후속 단계(콘텐츠 hash 기반 비용 절감)의 진입점이 된다.
- **API 일관성**: 단건/일괄/스크립트 모두 동일 파라미터 사용.

### 비용

- Backend: `data_router.py`, `ingestor.py` 시그니처 확장. `_process_file_*` 4-tuple 큐 확장.
- Frontend: `dialog`/`api`/`page` 4개 파일 수정.
- 테스트: `test_ingestor.py`에 모드별 케이스 3건 추가.

### 후속 작업 — 2026-04-27 모두 완료 (PR #66 동일 브랜치)

1. ✅ `mode=batch` 경로에 동일 정책 정렬 — `BatchService.submit(on_duplicate=...)` + `_ingest_batch_results`에 payload union, `_process_file_batch`에 skip 사전 차단. `BatchJob.on_duplicate` 컬럼 추가. 커밋 `b7c56fb`, `1ffcf61`.
2. ✅ `IngestionJob.content_hash` 컬럼 도입 → `skip` 모드에서 동일 콘텐츠면 임베딩 호출 자체 차단(Gemini 비용 절감). Alembic `dcf99a84bff1`. 커밋 `f2efd20`, `1e8c5b3`, `4e57a40`.
3. ✅ 일괄 업로드 결과 리포트 — `UploadResponse.predicted_outcome`, Admin UI 통계 토스트 + bulk skip 토글. 커밋 `fb99d00`, `cf86ef1`.
4. ✅ [부수 픽스] batch `uuid.NAMESPACE_DNS` → `NAMESPACE_URL`로 standard와 Point ID 정렬. 커밋 `ef971a3`.

---

## 4. Alternatives Considered

### A. 현재 설계 유지

기각 이유: 사용자에게 silent data loss를 강요한다. UX 결함이 이미 보고됨.

### B. 자동 union만 적용 (선택지 2 단독)

기각 이유: 의도적 분류 변경(`replace`) 표현이 불가능. 후속 운영 시나리오에서
재구성 작업을 막는다.

### C. 매번 모달 강제 (Open WebUI 패턴, 선택지 3 단독)

기각 이유: 일괄 업로드(615권 학습 데이터)에서 운영 피로 발생. API 일관성도 훼손
(스크립트/외부 채널은 모달을 띄울 수 없음). Hybrid(D)가 이 패턴을 포함하면서도 자동화 가능.

### D. Hybrid (선택, 본 ADR)

채택. Default safe + 명시적 옵트인 + 모달은 단건 업로드에 한해 표출.

---

## 5. References

- LlamaIndex Document Management Pipeline — https://developers.llamaindex.ai/python/examples/ingestion/document_management_pipeline/
- Pinecone duplicate handling 권장(커뮤니티) — https://community.pinecone.io/t/is-there-a-way-to-filter-out-duplicate-vectors-if-i-upload-the-same-document-twice/2474
- Qdrant Payload (upsert vs set_payload) — https://qdrant.tech/documentation/manage-data/payload/
- Open WebUI 중복 처리 옵션 패턴 — https://github.com/open-webui/open-webui/issues/20853
