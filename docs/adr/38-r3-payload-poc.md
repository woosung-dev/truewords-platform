# Dev-log 38 — R3 Payload 통일 + AnswerCitation volume_raw (PR #51 후보)

- **작성일**: 2026-04-25
- **브랜치**: `refactor/r3-payload-unification-poc`
- **상위**: 메인 플랜 §11 R3 Payload 통일. 본 PoC 는 §11.5 commit 1~4 에 정렬 (Collection Resolver / multi-collection 지원은 본 PoC 스코프 외)
- **연관**: `polymorphic-scribbling-bengio.md` Track A2

## Context

R3 의 두 부채를 단계적으로 해소하는 1단계 PoC.

1. **Payload 스키마 어긋남** — `pipeline/ingestor.py` 와 `pipeline/batch_service.py` 가 Qdrant 에 dict payload 를 직접 만들어 적재. 두 경로 사이에 `title`/`date` 필드 누락 차이가 있어 적재 후 search 측에서 `point.payload["title"]` 등 접근 시 KeyError 위험. search 측(`hybrid.py`/`fallback.py`)도 `point.payload["text"]` 직접 dict 인덱싱으로 동일 부채.
2. **AnswerCitation.volume 강제 캐스팅** — Qdrant payload 의 `volume` 은 문자열 ("001권" 등) 인데 DB 컬럼은 `int`. `chat/service.py:_record_citations` 에서 `int(volume) if volume.isdigit() else 0` 로 캐스팅하면서 원본 정보 소실.

## 변경 요약 (4 commits)

### Commit 1 (`9c4f08f`) — `QdrantChunkPayload` Pydantic 모델

`backend/src/pipeline/chunk_payload.py` 신규.

```python
class QdrantChunkPayload(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")
    payload_version: int = 1
    text: str
    volume: str
    chunk_index: int
    source: list[str]
    title: str = ""
    date: str = ""
```

- frozen=True: 한 번 만든 객체 변경 불가 (defensive)
- extra="ignore": v0 legacy payload 의 알 수 없는 필드 수용 (자연 마이그레이션)
- title/date 기본값 빈 문자열: batch_service 가 BatchJob 메타 부재 시 채울 수 있도록 (사용자 합의: "Pydantic 기본값 빈 문자열")

테스트: `tests/test_chunk_payload.py` 5건 (필수 / 기본값 / extra 무시 / model_dump 키 셋 / 누락 ValidationError).

### Commit 2 (`b7d81b6`) — ingestor + batch_service payload 통일

두 ingest 경로의 dict payload 형성을 `QdrantChunkPayload(...).model_dump()` 로 교체.

- `pipeline/ingestor.py` L170~: chunk.title / chunk.date 까지 7개 필드 채움
- `pipeline/batch_service.py` L128~: BatchJob 메타에 title/date 가 없으므로 모델 기본값 (빈 문자열) 적용

결과: 두 경로 payload 키 셋이 정확히 동일 (payload_version 포함).

### Commit 3 (`75d2125`) — search hybrid + fallback model_validate 경유 + legacy adapter

- `search/hybrid.py`: `point_to_search_result` 헬퍼 신설. v1 우선 파싱, ValidationError 시 v0 legacy dict 인덱싱 fallback. `_normalize_source` 헬퍼로 source list/str → 단일 string 정규화 일원화.
- `search/fallback.py`: 동일 헬퍼 import 사용. dead local helper `_extract_source` 제거 (DRY).

자연 마이그레이션 보장: 운영 Qdrant 의 v0 데이터 그대로 두고 v1 신규 적재만 적용. 강제 재적재 0건.

테스트: `tests/test_search_payload_read.py` 6건.

### Commit 4 (이번 commit) — `AnswerCitation.volume_raw` + Alembic migration + dev-log 38

- `chat/models.py:AnswerCitation`: `volume_raw: str | None = Field(default=None, max_length=64)` 추가. 기존 `volume: int` 보존 (2단계 마이그레이션 1단계).
- `chat/service.py:_record_citations`: `volume_raw=r.volume` 채움 (강제 캐스팅 유지하여 기존 동작 호환).
- Alembic migration `33d34f262dc2_add_volume_raw_to_answer_citation.py`: `op.add_column("answer_citations", sa.Column("volume_raw", sa.String(length=64), nullable=True))`. downgrade 는 `op.drop_column`.
- 단위 테스트 `tests/test_answer_citation_volume_raw.py` 2건: 강제 캐스팅 + raw 보존 검증.

## 검증 evidence

```bash
# 단위
$ uv run pytest tests/test_chunk_payload.py tests/test_search_payload_read.py \
    tests/test_answer_citation_volume_raw.py -x
13 passed

# 전체 회귀
$ uv run pytest -x
394 → 407 passed, 1 xfailed (+13 신규: chunk_payload 5 + search_payload_read 6 + volume_raw 2)

# 잔존 검증
$ rg 'point\.payload\["text"\]|point\.payload\["volume"\]' backend/src/search --type py
0건 (모든 read 가 point_to_search_result 경유)

$ rg 'payload\s*=\s*\{' backend/src/pipeline --type py
0건 (모든 ingest 가 QdrantChunkPayload.model_dump() 경유)
```

Alembic migration 은 staging DB 환경에서 `alembic upgrade head` 실 적용 필요 (로컬 PG 인증 미설정으로 본 세션 검증 외).

## 회귀 차단 / 자연 마이그레이션

- **legacy v0 payload 보호**: `extra="ignore"` + ValidationError fallback 로 v0 데이터 그대로 read 가능
- **두 ingest 경로의 키 셋 동일성**: 동일 모델로부터 model_dump() 호출이라 정의상 보장
- **AnswerCitation 2단계 마이그레이션**: 기존 `volume: int` 컬럼 그대로 남기고 `volume_raw` 만 NULL 가능 컬럼으로 추가 → 다운그레이드 안전 + 기존 query 영향 0

## 후속 항목 (본 PoC 스코프 외 — §23 원칙 4 "완벽보다 진행")

| 항목 | 위치 | 비고 |
|------|------|------|
| `BatchJob` 모델에 title/date 메타 추가 | `pipeline/batch_models.py` | 현재 batch_service 가 빈 문자열 채움. 메타 채움 후 진행 가능 |
| Collection Resolver / multi-collection 지원 | 메인 플랜 §11.5 commit 5~8 | R3 후속 PR. 본 PoC 외 |
| `AnswerCitation.volume` int 컬럼 제거 (2단계 마이그레이션 2단계) | `chat/models.py` + Alembic | volume_raw 만으로 충분해진 시점에 별도 PR |
| `pipeline/ingestor.py` rate_limit_exhausted 미사용 변수 정리 | `pipeline/ingestor.py` L132/L159 | 본 PR 영향 외 사전 issue |
| `_to_search_config` 의 weighted score_threshold 통합 | `chat/service.py` L67-69 | A1 cleanup PR (chore/r2-cleanup) 에서 처리. 본 R3 PoC 와 별개 |

## 메인 플랜 §23 준수 점검

- 검증 루프: commit 당 1회 (red→green→commit). 3회 상한 미접근.
- 문서 분량: 약 110줄 / 임계 2,000줄 충분 여유.
- Δ 누적: 회귀 차단 보강 없음 (자연 마이그레이션 100%). 0 / 3개 한도. 진행.
