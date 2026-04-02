# Phase 3: 데이터 파이프라인 스케일 — 구현 계획

> 스펙 문서: `docs/superpowers/specs/2026-03-28-phase3-data-pipeline-design.md`

---

## Goal

615권 말씀선집을 안정적으로 Qdrant에 적재하는 production-grade 파이프라인 구축.
문장 경계 청킹, 메타데이터 강화, 증분 적재, 진행 추적, HWP 변환, 시맨틱 캐시, 배치 통계 리포트.

## Architecture

```
scripts/convert_hwp.py  →  scripts/ingest.py (통합 CLI)
                               │
         ┌─────────────────────┼────────────────────────┐
         ▼                     ▼                        ▼
  converter.py          metadata.py              progress.py
         │                     │                        │
         └─────────┬───────────┘                        │
                   ▼                                    │
             chunker.py (v2: 문장 경계)                  │
                   │                                    │
                   ▼                                    │
             ingestor.py (v2: 메타 payload + 증분)  ◄───┘
                   │
                   ▼
             reporter.py → reports/*.json

  [별도] src/cache/semantic_cache.py → Qdrant "semantic_cache"
         api/routes.py의 chat() 핸들러에 캐시 체크 통합
```

> **[Eng Review 수정]** 캐시 통합 대상이 `src/chat/service.py`가 아닌 `api/routes.py`의 `chat()` 함수임. 현재 프로젝트에 service.py 파일이 존재하지 않으며, 라우트 핸들러에서 직접 search + generate를 호출하는 구조.

## Tech Stack

- Python 3.12+, FastAPI, Qdrant, google-genai 1.68.0, fastembed
- 신규: `kss` (한국어 문장 분리), `pyhwp` (hwp5txt), libreoffice (폴백)
- 테스트: pytest, unittest.mock

---

## 파일 구조 맵

```
backend/
├── src/
│   ├── config.py                        # [수정] 신규 설정 추가
│   ├── qdrant_client.py                 # [수정] 캐시 collection 생성
│   ├── cache/
│   │   ├── __init__.py                  # [신규]
│   │   └── semantic_cache.py            # [신규] 시맨틱 캐시
│   ├── chat/
│   │   └── generator.py                 # [유지]
├── api/
│   └── routes.py                        # [수정] 캐시 통합
│   └── pipeline/
│       ├── chunker.py                   # [수정] 문장 경계 청킹
│       ├── converter.py                 # [신규] HWP→TXT
│       ├── embedder.py                  # [유지]
│       ├── ingestor.py                  # [수정] 증분 + 메타 + 백오프
│       ├── metadata.py                  # [신규] 메타데이터 추출
│       ├── progress.py                  # [신규] 진행 추적
│       └── reporter.py                  # [신규] 배치 통계
├── scripts/
│   ├── convert_hwp.py                   # [신규] HWP 변환 CLI
│   └── ingest.py                        # [수정] 통합 파이프라인
├── tests/
│   ├── test_chunker.py                  # [수정] 문장 경계 테스트 추가
│   ├── test_converter.py               # [신규]
│   ├── test_ingestor.py                # [수정] 증분/메타 테스트 추가
│   ├── test_metadata.py                # [신규]
│   ├── test_progress.py                # [신규]
│   ├── test_reporter.py                # [신규]
│   └── test_semantic_cache.py          # [신규]
└── reports/                             # [신규] 배치 통계 출력 디렉토리
```

---

## Task 1: 문장 경계 청킹 개선

**Files:** `src/pipeline/chunker.py`, `tests/test_chunker.py`

### Steps

- [ ] **1.1** `kss` 의존성 추가
  - `uv add kss`
  - Expected: `pyproject.toml`에 kss 추가됨

- [ ] **1.2** `Chunk` dataclass 확장 (하위 호환)
  - `src/pipeline/chunker.py`에 `title: str = ""`, `date: str = ""` 필드 추가
  - Expected: 기존 `Chunk(text=..., volume=..., chunk_index=...)` 호출 그대로 동작

- [ ] **1.3** 문장 경계 청킹 테스트 작성 (RED)
  - `tests/test_chunker.py`에 추가:
    - `test_sentence_boundary_chunking_preserves_sentences`: 문장 중간 절단 없음 확인
    - `test_sentence_chunking_respects_max_chars`: max_chars 초과 시 분리
    - `test_sentence_chunking_overlap`: 오버랩 문장 포함 확인
    - `test_chunk_has_optional_metadata_fields`: title, date 기본값 테스트
  - 실행: `cd backend && uv run pytest tests/test_chunker.py -v`
  - Expected: 신규 4개 FAIL

- [ ] **1.4** `chunk_text` 함수 리팩토링 (GREEN)
  - `kss.split_sentences()`로 문장 분리
  - 문장 단위 누적 → max_chars 초과 시 새 청크
  - 오버랩: 마지막 `overlap_sentences=1` 문장을 다음 청크에 포함
  - 함수 시그니처: `chunk_text(text, volume, max_chars=500, overlap_sentences=1, title="", date="")`
  - 기존 `overlap` 파라미터는 deprecated (하위 호환 유지)
  - Expected: 기존 6개 + 신규 4개 = 10개 테스트 통과

- [ ] **1.5** 기존 테스트 통과 확인
  - `cd backend && uv run pytest tests/test_chunker.py tests/test_ingestor.py -v`
  - Expected: 전부 PASS

---

## Task 2: 메타데이터 추출 모듈

**Files:** `src/pipeline/metadata.py`, `tests/test_metadata.py`

### Steps

- [ ] **2.1** 메타데이터 추출 테스트 작성 (RED)
  - `tests/test_metadata.py` 생성:
    - `test_extract_volume_number_from_filename`: `"말씀선집_001_제목.txt"` → `volume="001"`
    - `test_extract_title_from_filename`: 파일명에서 제목 추출
    - `test_extract_date_from_content`: 텍스트 첫 줄에서 날짜 패턴 추출
    - `test_fallback_when_no_metadata`: 메타 없으면 빈 문자열 반환
  - Expected: 4개 FAIL

- [ ] **2.2** `metadata.py` 구현 (GREEN)
  - `extract_metadata(filepath: Path, text: str) -> dict` 함수
  - 파일명 패턴: 정규식으로 권번호, 제목 추출
  - 텍스트 내 날짜: `YYYY.MM.DD` 또는 `YYYY년 MM월 DD일` 패턴
  - 반환: `{"volume": str, "title": str, "date": str}`
  - Expected: 4개 PASS

---

## Task 3: 진행 상황 추적 모듈

**Files:** `src/pipeline/progress.py`, `tests/test_progress.py`

### Steps

- [ ] **3.1** 진행 추적 테스트 작성 (RED)
  - `tests/test_progress.py` 생성:
    - `test_create_new_progress_file`: 파일 없으면 새로 생성
    - `test_load_existing_progress`: 기존 JSON 로드
    - `test_mark_volume_completed`: 완료 목록에 추가
    - `test_mark_volume_failed`: 실패 목록에 추가 (사유 포함)
    - `test_is_volume_completed`: 이미 완료된 권 체크
    - `test_save_and_reload_consistency`: 저장 후 다시 로드해도 동일
    - `test_corrupted_json_handled_gracefully`: 손상된 JSON 파일 로드 시 빈 상태로 초기화 (데이터 유실 방지)
    - `test_atomic_save_on_crash`: save() 중 예외 시 기존 파일 보존 (임시 파일 → rename 전략)
  - Expected: 8개 FAIL

- [ ] **3.2** `progress.py` 구현 (GREEN)
  - `ProgressTracker` 클래스:
    - `__init__(self, filepath: Path)`
    - `load() -> None`
    - `save() -> None`
    - `is_completed(volume: str) -> bool`
    - `mark_completed(volume: str, chunk_count: int) -> None`
    - `mark_failed(volume: str, reason: str) -> None`
    - `get_summary() -> dict`
  - JSON 구조: 스펙 문서의 progress.json 형식
  - **[Eng Review 추가]** save()는 임시 파일에 쓴 후 `os.replace()`로 원자적 교체 (crash-safe)
  - **[Eng Review 추가]** load()에서 JSON 파싱 실패 시 `logging.warning` + 빈 상태 초기화 (기존 파일 `.bak` 백업)
  - Expected: 8개 PASS

---

## Task 4: HWP→TXT 변환 모듈

**Files:** `src/pipeline/converter.py`, `scripts/convert_hwp.py`, `tests/test_converter.py`

### Steps

- [ ] **4.1** 의존성 추가
  - `uv add pyhwp` (hwp5txt 포함)
  - Expected: pyproject.toml에 pyhwp 추가

- [ ] **4.2** 변환 테스트 작성 (RED)
  - `tests/test_converter.py` 생성:
    - `test_convert_hwp_to_txt_with_hwp5txt`: mock으로 hwp5txt 호출 확인
    - `test_convert_skips_existing_txt`: .txt 이미 존재 시 스킵
    - `test_convert_fallback_to_libreoffice`: hwp5txt 실패 시 libreoffice 호출
    - `test_convert_both_fail_logs_error`: 둘 다 실패 시 에러 반환
    - `test_convert_directory_processes_all_hwp`: 디렉토리 내 전체 HWP 처리
  - Expected: 5개 FAIL

- [ ] **4.3** `converter.py` 구현 (GREEN)
  - `convert_hwp_to_txt(hwp_path: Path, output_dir: Path) -> Path | None`
  - `convert_directory(input_dir: Path, output_dir: Path) -> list[dict]`
    - 반환: `[{"file": "...", "status": "success|failed", "error": "..."}]`
  - hwp5txt subprocess 호출 → 실패 시 libreoffice subprocess → 실패 시 None + 로그
  - Expected: 5개 PASS

- [ ] **4.4** CLI 스크립트 작성
  - `scripts/convert_hwp.py`: `python scripts/convert_hwp.py <input_dir> <output_dir>`
  - Expected: 수동 실행 가능

---

## Task 5: Ingestor 개선 (증분 적재 + 메타데이터 + 백오프)

**Files:** `src/pipeline/ingestor.py`, `src/config.py`, `tests/test_ingestor.py`

### Steps

- [ ] **5.1** Config 확장
  - `src/config.py`에 추가:
    ```python
    embed_delay: float = 0.2
    retry_base_wait: float = 30.0
    retry_max_retries: int = 5
    cache_collection_name: str = "semantic_cache"
    cache_score_threshold: float = 0.93
    cache_ttl_days: int = 7
    progress_file: str = "progress.json"
    ```
  - Expected: 기존 설정 불변, 신규 설정 기본값으로 동작

- [ ] **5.2** Ingestor 테스트 추가 (RED)
  - `tests/test_ingestor.py`에 추가:
    - `test_ingest_payload_includes_title_and_date`: 확장 메타데이터 확인
    - `test_exponential_backoff_on_429`: 지수 백오프 동작 확인 (sleep mock으로 대기 시간 검증)
    - `test_ingest_returns_statistics`: 적재 후 통계 dict 반환
    - `test_max_retries_exhausted_raises`: 최대 재시도 소진 시 예외 발생 확인
    - `test_non_429_error_not_retried`: 429 외 에러는 즉시 raise
  - Expected: 5개 FAIL

- [ ] **5.3** `ingestor.py` 리팩토링 (GREEN)
  - payload에 `title`, `date` 필드 추가 (Chunk에서 가져옴)
  - `_embed_with_retry` 지수 백오프: `retry_base_wait * (2 ** attempt)`
  - `embed_delay`를 settings에서 읽기
  - `ingest_chunks` 반환값 추가: `{"chunk_count": int, "elapsed_sec": float, "errors": list}`
  - Expected: 기존 3개 + 신규 5개 = 8개 PASS

---

## Task 6: 배치 통계 리포트

**Files:** `src/pipeline/reporter.py`, `tests/test_reporter.py`

### Steps

- [ ] **6.1** 리포트 테스트 작성 (RED)
  - `tests/test_reporter.py` 생성:
    - `test_generate_report_creates_json_file`: reports/ 디렉토리에 JSON 생성
    - `test_report_contains_volume_stats`: 권별 청크 수, 소요 시간 포함
    - `test_report_contains_error_summary`: 오류 목록 포함
    - `test_report_filename_has_timestamp`: 파일명에 타임스탬프 포함
  - Expected: 4개 FAIL

- [ ] **6.2** `reporter.py` 구현 (GREEN)
  - `BatchReporter` 클래스:
    - `add_volume_stat(volume: str, chunk_count: int, elapsed_sec: float) -> None`
    - `add_error(volume: str, error: str) -> None`
    - `generate(output_dir: Path) -> Path`
  - JSON 출력 형식:
    ```json
    {
      "generated_at": "2026-03-28T15:00:00",
      "total_volumes": 615,
      "total_chunks": 123000,
      "total_time_sec": 36000,
      "volumes": [{"volume": "001", "chunks": 206, "time_sec": 61.8}],
      "errors": [{"volume": "003", "error": "HWP 변환 실패"}]
    }
    ```
  - Expected: 4개 PASS

---

## Task 7: 시맨틱 캐시

**Files:** `src/cache/__init__.py`, `src/cache/semantic_cache.py`, `src/qdrant_client.py`, `tests/test_semantic_cache.py`

### Steps

- [ ] **7.1** 캐시 collection 생성 함수 추가
  - `src/qdrant_client.py`에 `create_cache_collection(client, name)` 추가
  - dense 벡터만 (3072 dims, COSINE) — 캐시는 sparse 불필요

- [ ] **7.2** 시맨틱 캐시 테스트 작성 (RED)
  - `tests/test_semantic_cache.py` 생성:
    - `test_cache_miss_returns_none`: 빈 캐시에서 조회 시 None
    - `test_cache_store_and_hit`: 저장 후 유사 질의로 히트
    - `test_cache_ttl_expired_returns_none`: TTL 만료 시 미스
    - `test_cache_below_threshold_returns_none`: 유사도 낮으면 미스
  - Expected: 4개 FAIL (mock 기반)

- [ ] **7.3** `semantic_cache.py` 구현 (GREEN)
  - `SemanticCache` 클래스:
    - `__init__(self, client: QdrantClient, collection_name: str, threshold: float, ttl_days: int)`
    - `get(self, query_embedding: list[float]) -> dict | None`
      - 반환: `{"answer": str, "sources": list}` 또는 None
    - `put(self, query_embedding: list[float], question: str, answer: str, sources: list) -> None`
  - Qdrant search with `score_threshold` + `created_at` 필터
  - Expected: 4개 PASS

- [ ] **7.4** `api/routes.py`의 `chat()` 핸들러에 캐시 통합
  - `api/routes.py`에서:
    1. `embed_dense_query(request.query)` 로 질문 임베딩 생성
    2. `SemanticCache.get(query_embedding)` 시도
    3. 히트 → `ChatResponse(answer=cached["answer"], sources=cached["sources"])` 즉시 반환
    4. 미스 → 기존 `hybrid_search()` + `generate_answer()` → `SemanticCache.put()` 후 반환
  - 기존 API 스펙 불변: `{answer, sources[{volume, text, score}]}`
  - **[Eng Review 추가]** `test_api.py`에 캐시 관련 테스트 추가:
    - `test_chat_returns_cached_response`: mock SemanticCache.get() 히트 시 generate_answer 호출 안 함
    - `test_chat_caches_on_miss`: 미스 시 SemanticCache.put() 호출 확인

- [ ] **7.5** 캐시 collection 초기화 스크립트
  - `scripts/ingest.py` 또는 별도 `scripts/init_cache.py`에서 Qdrant `semantic_cache` collection 생성
  - 앱 시작 시 collection 존재 여부 체크 → 없으면 자동 생성 (방어 코드)

---

## Task 8: 통합 적재 스크립트 개선

**Files:** `scripts/ingest.py`

### Steps

- [ ] **8.1** `scripts/ingest.py` 리팩토링
  - CLI 인자: `python scripts/ingest.py <data_dir> [--resume] [--convert-hwp] [--report-dir reports/]`
  - 흐름:
    1. `--convert-hwp` 시 HWP→TXT 변환 먼저 실행
    2. ProgressTracker 로드 (--resume 시 기존 progress.json 읽기)
    3. .txt 파일 순회, completed_volumes 스킵
    4. metadata 추출 → chunk_text → ingest_chunks
    5. 권별 progress 업데이트 + reporter 기록
    6. 전체 완료 후 리포트 생성
  - Expected: 기존 `python scripts/ingest.py <data_dir>` 동작 유지 (하위 호환)

- [ ] **8.2** 통합 테스트 (수동)
  - `cd backend && uv run python scripts/ingest.py ../data/sample/ --resume --report-dir reports/`
  - Expected: progress.json 생성, reports/*.json 생성, Qdrant 적재 확인

---

## Task 9: 전체 테스트 통과 확인

### Steps

- [ ] **9.1** 전체 테스트 실행
  - `cd backend && uv run pytest -v`
  - Expected: 기존 24개 + 신규 ~30개 = ~54개 전부 PASS

- [ ] **9.2** 타입 체크 (선택)
  - `cd backend && uv run mypy src/ --ignore-missing-imports`
  - Expected: 에러 0개 또는 기존과 동일

---

## 태스크 요약

| Task | 설명 | 신규 테스트 수 | 예상 시간 |
|------|------|--------------|----------|
| T1 | 문장 경계 청킹 | 4 | 15분 |
| T2 | 메타데이터 추출 | 4 | 10분 |
| T3 | 진행 상황 추적 | 8 | 15분 |
| T4 | HWP→TXT 변환 | 5 | 15분 |
| T5 | Ingestor 개선 | 5 | 15분 |
| T6 | 배치 통계 리포트 | 4 | 10분 |
| T7 | 시맨틱 캐시 | 6 (4 + 2 API) | 25분 |
| T8 | 통합 스크립트 개선 | 0 (수동) | 15분 |
| T9 | 전체 테스트 확인 | 0 | 5분 |
| **합계** | | **36** | **~125분** |

---

## Self-Review Checklist

- [x] 스펙 S1~S7 모두 태스크에 매핑됨
- [x] 모든 Step에 실행 명령어 + Expected 결과 포함
- [x] placeholder/TODO 없음 — 모든 코드 경로 구체적
- [x] `Chunk` dataclass 하위 호환 유지 (기본값 있는 필드만 추가)
- [x] Qdrant payload `{text, volume, chunk_index}` 기본 불변 (title, date 추가만)
- [x] POST /chat API 응답 스키마 불변 — 내부 구현(캐시 체크/저장)은 변경됨
- [x] 타입 일관성: str, Path, list[float], dict 명시
- [x] 캐시 통합 대상 파일 정정 (routes.py)
- [x] progress.json 원자적 저장 + 손상 복구 추가
- [x] 재시도 에지 케이스 테스트 추가

---

## Engineering Review Report

> 리뷰일: 2026-03-28
> 리뷰어: AI Eng Review

### 1. 아키텍처 경계 — PASS (수정 반영)

**발견 이슈 1건, 수정 완료:**
- **[수정됨]** Task 7.4에서 `src/chat/service.py`를 수정 대상으로 지정했으나, 해당 파일은 존재하지 않음. 실제 캐시 통합 지점은 `api/routes.py`의 `chat()` 함수. 파일 구조 맵과 Task 7.4 모두 수정 완료.

**양호한 점:**
- chunker / ingestor / progress / reporter / cache 모듈 책임이 명확히 분리됨
- 각 모듈은 단일 책임 원칙 준수: converter는 변환만, metadata는 추출만, progress는 추적만
- 새 모듈은 모두 `src/pipeline/` 하위에 배치되어 기존 구조와 일관

### 2. 데이터 흐름 — PASS

**HWP→TXT→Chunk→Embed→Qdrant 파이프라인:**
1. `converter.py`: HWP → TXT (hwp5txt/libreoffice 폴백 체인)
2. `metadata.py`: 파일명 + 텍스트에서 volume/title/date 추출
3. `chunker.py`: 문장 경계 기반 청킹 (kss + max_chars)
4. `ingestor.py`: dense + sparse 임베딩 → Qdrant upsert + payload (text, volume, chunk_index, title, date)
5. `progress.py`: 권별 완료/실패 기록
6. `reporter.py`: 배치 통계 JSON 출력

데이터 타입 흐름: `Path → str(text) → dict(metadata) → Chunk → PointStruct → Qdrant`
일관성 확인됨.

### 3. 테스트 커버리지 — PASS (보강 반영)

**보강된 테스트 (6건 추가):**
- `test_max_retries_exhausted_raises`: rate limit 재시도 소진 시 예외 확인
- `test_non_429_error_not_retried`: 429 외 에러 즉시 전파
- `test_corrupted_json_handled_gracefully`: progress.json 손상 대응
- `test_atomic_save_on_crash`: 원자적 저장 검증
- `test_chat_returns_cached_response`: API 캐시 히트 테스트
- `test_chat_caches_on_miss`: API 캐시 미스 + 저장 테스트

**아직 자동화 테스트 없는 영역 (의도적 제외):**
- `scripts/ingest.py` 통합 흐름 → 수동 테스트 (Task 8.2). Qdrant Docker 의존이라 CI에서 돌리려면 testcontainers 필요. Phase 4에서 고려.
- HWP 실제 파일 변환 → 실물 HWP 파일 없이 subprocess mock으로 대체. 적절한 판단.

### 4. 성능 — CONDITIONAL PASS

**615권 적재 시간 예측:**
- 123,000 청크 x 0.3초/청크 = ~10.25시간 (최적)
- rate limit 재시도 포함 시 ~12~15시간
- 이는 단일 프로세스, 무료 Gemini 티어 기준이며 현실적인 수치

**병렬화 가능 구간:**
- BM25 로컬 임베딩: 이미 빠름 (ms 단위), 병렬화 불필요
- Gemini API 호출: rate limit 때문에 병렬화 효과 없음 (초당 5 요청 제한)
- HWP→TXT 변환: 독립적이므로 `multiprocessing.Pool` 가능하나 Phase 3 범위 밖으로 적절
- progress.json 쓰기: 단일 프로세스이므로 동시 쓰기 이슈 없음

**[확인 필요]** Gemini 유료 티어 전환 시 rate limit이 초당 몇 요청으로 완화되는지 확인. 10배 완화 시 적재 시간 1~2시간으로 단축 가능.

### 5. 실패 모드 — PASS (보강 반영)

| 실패 모드 | 대응 | 상태 |
|----------|------|------|
| Gemini 429 연속 | 지수 백오프 (30→60→120→240→480초) + 최대 5회 | 계획에 반영 |
| Gemini 429 5회 소진 | 해당 청크 스킵, failed_volumes에 기록 + 리포트 | 계획에 반영 |
| Gemini non-429 에러 | 즉시 raise, failed_volumes 기록 | **리뷰에서 추가** |
| HWP 변환 실패 | hwp5txt → libreoffice 폴백 → 스킵 + 에러 로그 | 계획에 반영 |
| progress.json 손상 | 로드 실패 시 .bak 백업 + 빈 상태 초기화 | **리뷰에서 추가** |
| progress.json 쓰기 중 crash | 임시 파일 → os.replace() 원자적 교체 | **리뷰에서 추가** |
| 네트워크 끊김 | Qdrant/Gemini 모두 기존 retry 로직에 의존 + progress 복원 | 계획에 반영 |
| 디스크 부족 | 적재 전 경고 없음 → [확인 필요] 사전 체크 추가 여부 | Phase 3 범위 밖 |
| 중복 적재 | progress.json completed_volumes 체크 | 계획에 반영 |

### 6. NOT in scope 확인 — PASS

스펙 문서와 계획 문서의 범위 제한이 일치함:
- 계층적 청킹 (parent_chunk_id) → Phase 4
- Re-ranking, Query Expansion → Phase 4
- 클라우드 배포 → Phase 4
- POST /chat API 변경 → 없음
- 프론트엔드 → 별도

**주의:** 시맨틱 캐시는 "Phase 3 범위"에 포함되어 있으나, 실제 효과 검증은 운영 트래픽이 있어야 가능. Phase 3에서는 "기능 동작" 수준까지만 구현하고, 임계값 튜닝은 Phase 4에서 수행하는 것이 적절.

### 최종 판정: **APPROVED with notes**

계획 실행 가능. 아래 사항만 구현 시 주의:

1. `kss` 라이브러리가 종교 텍스트의 고어체/경어체 문장을 제대로 분리하는지 1~2개 권으로 먼저 검증 후 전체 적재 진행
2. `ingest_chunks()`의 반환값 변경은 기존 `scripts/ingest.py`의 호출부도 함께 수정해야 함 (하위 호환 주의)
3. `Chunk` dataclass에 `title`, `date` 추가 시 dataclass 필드 순서 주의 — 기본값 있는 필드는 기본값 없는 필드 뒤에 와야 함 (Python dataclass 규칙)
