# ADR-27: 마지막 카테고리 태그 제거 허용 (미분류 상태 전이)

> **날짜:** 2026-04-14
> **상태:** 확정 (코드 변경은 PR #24에 포함되어 머지됨)
> **관련:** PR #22 (bulk 엔드포인트 최초 구현), PR #24 (NFC/NFD fix + 본 정책 변경), `backend/src/datasource/qdrant_service.py`

---

## 배경

PR #22에서 bulk 태그 제거 구현 시 "마지막 카테고리 태그는 제거할 수 없다"는 보호 로직을 넣었다. 단일 `remove_volume_tag` 역시 `ValueError`로 요청을 거절했다.

의도는 실수로 문서를 "orphan 상태"로 떨어뜨리는 것을 막는 데이터 유실 방지였다.

## 문제

운영 중 이 정책이 **시스템 전체의 데이터 모델과 비일관**하다는 것이 드러났다:

1. **업로드 파이프라인**: `POST /admin/data-sources/upload`는 `source=""`(빈 문자열)을 공식적으로 허용 (`data_router.py:243`). 즉 **"미분류로 업로드"는 정상 경로**.
2. **조회 API**: `get_all_volumes`와 `get_category_stats`는 `source=[]`인 볼륨을 정상 반환.
3. **Admin UI**: `category-tab.tsx`에 **"미분류 문서" 가상 행**이 이미 구현되어 있고, `sources.length === 0`인 볼륨을 거기에 노출. Transfer UI의 "미분류 모드"도 존재.
4. **운영 현실**: `말씀선집 002`처럼 한 파일이 "미분류"와 "말씀선집" 카테고리에 동시에 나타나는 사례가 관측됨 → 미분류는 이미 1급 상태.

미분류가 1급 상태라면, "A에만 속한 문서를 A에서 빼기" 시도는 **"미분류로 이동"이라는 자연스러운 의미**를 가진다. 이걸 거절하는 것은 오히려:

- 사용자가 의도를 달성하지 못하고 혼란 ("왜 저장이 안 되지?")
- 우회 방법이 번거로움: 다른 카테고리 아무거나 붙였다가 원래 태그 빼고 다시 새 태그 빼야 함
- 미분류 개념을 부정하는 UX 신호

## 결정

**마지막 태그 제거를 허용한다.** 제거 후 `source=[]`가 되면 해당 볼륨은 자연스럽게 "미분류" 섹션에 노출된다.

### 변경 사항

- `qdrant_service.remove_volume_tag`: `ValueError` raise 제거, 모든 태그 제거 허용
- `qdrant_service.remove_volume_tags_bulk`: `has_single` skip 로직 제거, 그룹핑 로직 단순화
- `data_router.remove_volume_tag`: `try/except ValueError` 제거 (dead code)

### 기대 효과

- 사용자 의도와 동작이 일치 → 혼란 감소
- 코드 단순화 (bulk remove는 add와 동일 구조로 정리)
- 시스템 전체 데이터 모델 일관성 확보

## 대안 (채택 안 함)

- **확인 다이얼로그 삽입**: "이 문서는 미분류로 이동합니다. 계속하시겠습니까?" — Bulk 작업에서 매번 뜨면 번거로움. Transfer UI의 "변경 요약"(+N건 추가 / -N건 제거) 표시가 이미 충분한 사전 신호.
- **허용하되 별도 안내 토스트**: 구현 복잡도 대비 가치 낮음. 필요 시 추후 추가.

## 후속

- 원래 skipped_volumes에 담겼던 "마지막 태그라 제거 불가" 메시지는 더 이상 발생하지 않음. 프론트의 `skipped_volumes` 처리는 그대로 유지 (다른 skip 이유 "이미 태그가 없음", "Qdrant에 volume 없음"은 남아있음).
