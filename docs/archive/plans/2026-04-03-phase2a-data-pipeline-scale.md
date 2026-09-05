# Phase 2A: 데이터 파이프라인 스케일 — 구현 계획 (수정판)

> **작성일:** 2026-04-03
> **기반 설계:** `plans/2026-03-28-phase3-data-pipeline.md` (원본)
> **변경 사유:** 실제 데이터 형식 확인 (PDF 95%, HWP 제출 제한), 현재 코드 상태 반영

---

## Goal

615권 말씀선집 + 원리강론 + 3대경전 + 자서전을 Qdrant에 안정적으로 적재하는 파이프라인 구축.
멀티포맷 텍스트 추출 (PDF/DOCX/TXT), 문장 경계 청킹, A/B source 자동 분류, 증분 적재, 진행 추적, 배치 통계 리포트.

## 데이터 현황

| 소스 | 폴더 | 파일 수 | 형식 | source |
|------|------|---------|------|--------|
| 원리강론 | 원리강론/ | 60개 | TXT (사용자가 HWP에서 변환) | A |
| 3대경전 | 3대경전(증보판)/ | 4개 | DOCX 2 + PDF 1 + TXT 1 | A |
| 참부모님 자서전 | 참부모님 자서전/ | 3개 | TXT 2 + PDF 1 | B |
| 말씀선집 615권 | 문선명선생 말씀선집/ | 1,230개 | PDF (사용자가 ZIP 해제) | B |
| **합계** | | **~1,297개** | | |

> **중요:** 파일 제공, ZIP 해제, HWP→TXT 변환은 모두 사용자가 직접 수행.
> 파이프라인은 TXT/PDF/DOCX만 처리. HWP 입력 시 에러 메시지로 안내.

## Architecture

```
사용자가 데이터 폴더 준비 (TXT/PDF/DOCX)
         │
         ▼
  scripts/ingest.py (통합 CLI)
         │
         ├── extractor.py ─── PDF: pymupdf
         │                 ├── DOCX: python-docx
         │                 ├── TXT: open().read()
         │                 └── HWP: 거부 + 안내 메시지
         │
         ├── metadata.py ──── 파일명 → volume/title
         │                 └── 폴더 경로 → source (A/B)
         │
         ├── chunker.py ───── kss 문장 경계 청킹
         │
         ├── ingestor.py ──── 임베딩 + Qdrant upsert
         │
         ├── progress.py ──── 증분 적재 추적 (JSON)
         │
         └── reporter.py ──── 배치 통계 리포트
```

---

## 파일 구조 맵

```
backend/
├── src/pipeline/
│   ├── chunker.py              # [수정] kss 문장 경계 청킹 + title/date 필드
│   ├── extractor.py            # [신규] PDF/DOCX/TXT 텍스트 추출
│   ├── metadata.py             # [신규] 파일명 → 메타데이터 + 폴더 → source 분류
│   ├── ingestor.py             # [수정] 지수 백오프 + 메타 payload + 통계 반환
│   ├── progress.py             # [신규] 증분 적재 추적 (원자적 저장)
│   ├── reporter.py             # [신규] 배치 통계 JSON 리포트
│   └── embedder.py             # [유지]
├── scripts/
│   └── ingest.py               # [수정] 멀티포맷 + 증분 + 리포트 통합 CLI
├── tests/
│   ├── test_extractor.py       # [신규]
│   ├── test_metadata.py        # [신규]
│   ├── test_progress.py        # [신규]
│   ├── test_reporter.py        # [신규]
│   ├── test_chunker.py         # [수정] kss 테스트 추가
│   └── test_ingestor.py        # [수정] 지수 백오프 테스트 추가
└── reports/                    # [신규] 배치 통계 출력 디렉토리
```

---

## Task 1: 텍스트 추출 모듈 (extractor.py)

**Files:** `src/pipeline/extractor.py`, `tests/test_extractor.py`
**의존성:** `pymupdf`, `python-docx`

- [ ] **1.1** 의존성 추가: `uv add pymupdf python-docx`
- [ ] **1.2** 테스트 작성 (RED) — 5개
  - `test_extract_txt_reads_file`: TXT 파일 읽기
  - `test_extract_pdf_returns_text`: PDF mock 텍스트 추출
  - `test_extract_docx_returns_text`: DOCX mock 텍스트 추출
  - `test_extract_hwp_raises_error`: HWP 파일 시 안내 에러
  - `test_extract_unknown_format_raises`: 미지원 형식 에러
- [ ] **1.3** 구현 (GREEN)
  - `extract_text(filepath: Path) -> str`
  - 확장자 기반 분기: .txt, .pdf, .docx
  - .hwp → `ValueError("HWP 파일은 TXT로 변환 후 제공해주세요")`
- [ ] **1.4** 테스트 통과 확인

---

## Task 2: 메타데이터 추출 + source 분류 (metadata.py)

**Files:** `src/pipeline/metadata.py`, `tests/test_metadata.py`

- [ ] **2.1** 테스트 작성 (RED) — 6개
  - `test_extract_volume_from_filename`: `"001권.pdf"` → volume="001"
  - `test_extract_title_from_filename`: 파일명에서 제목 추출
  - `test_extract_date_from_content`: 텍스트에서 날짜 패턴 추출
  - `test_classify_source_wonri`: 원리강론 폴더 → source="A"
  - `test_classify_source_malssum`: 말씀선집 폴더 → source="B"
  - `test_fallback_metadata`: 메타 없으면 빈 문자열
- [ ] **2.2** 구현 (GREEN)
  - `extract_metadata(filepath: Path, text: str) -> dict`
  - `classify_source(filepath: Path) -> str` — 폴더명 기반 A/B 분류
  - 분류 규칙:
    - `원리강론` 또는 `3대경전` 포함 → "A"
    - `자서전` 또는 `말씀선집` 포함 → "B"
    - 기타 → "B" (기본값)
- [ ] **2.3** 테스트 통과 확인

---

## Task 3: 문장 경계 청킹 개선 (chunker.py)

**Files:** `src/pipeline/chunker.py`, `tests/test_chunker.py`
**의존성:** `kss`

- [ ] **3.1** 의존성 추가: `uv add kss`
- [ ] **3.2** Chunk dataclass 확장: `title: str = ""`, `date: str = ""` 추가
- [ ] **3.3** 테스트 추가 (RED) — 4개
  - `test_sentence_boundary_preserves_sentences`: 문장 중간 절단 없음
  - `test_sentence_chunking_respects_max_chars`: max_chars 초과 시 분리
  - `test_sentence_chunking_overlap`: 오버랩 문장 포함
  - `test_chunk_has_title_date_fields`: title/date 기본값
- [ ] **3.4** `chunk_text` kss 기반 리팩토링 (GREEN)
  - 기존 테스트 8개 + 신규 4개 = 12개 통과
- [ ] **3.5** 기존 테스트 하위 호환 확인

---

## Task 4: 진행 추적 모듈 (progress.py)

**Files:** `src/pipeline/progress.py`, `tests/test_progress.py`

- [ ] **4.1** 테스트 작성 (RED) — 6개
  - `test_create_new_progress`: 새 파일 생성
  - `test_mark_completed`: 완료 기록
  - `test_mark_failed`: 실패 기록 (사유 포함)
  - `test_is_completed`: 완료 여부 체크
  - `test_save_reload_consistency`: 저장 후 재로드 일관성
  - `test_atomic_save`: os.replace 원자적 저장
- [ ] **4.2** ProgressTracker 구현 (GREEN)
- [ ] **4.3** 테스트 통과 확인

---

## Task 5: Ingestor 개선 (ingestor.py)

**Files:** `src/pipeline/ingestor.py`, `tests/test_ingestor.py`

- [ ] **5.1** 테스트 추가 (RED) — 4개
  - `test_payload_includes_title_date`: 확장 메타데이터 payload
  - `test_exponential_backoff_on_429`: 지수 백오프 (30→60→120초)
  - `test_max_retries_exhausted`: 5회 소진 시 예외
  - `test_ingest_returns_statistics`: 적재 통계 반환
- [ ] **5.2** ingestor 리팩토링 (GREEN)
  - payload에 title/date/source 추가
  - 지수 백오프: `base_wait * (2 ** attempt)`
  - 반환값: `{"chunk_count": int, "elapsed_sec": float}`
- [ ] **5.3** 기존 5개 + 신규 4개 = 9개 통과

---

## Task 6: 배치 통계 리포트 (reporter.py)

**Files:** `src/pipeline/reporter.py`, `tests/test_reporter.py`

- [ ] **6.1** 테스트 작성 (RED) — 4개
- [ ] **6.2** BatchReporter 구현 (GREEN)
- [ ] **6.3** 테스트 통과 확인

---

## Task 7: 통합 CLI 스크립트 (ingest.py)

**Files:** `scripts/ingest.py`

- [ ] **7.1** CLI 리팩토링
  - `python scripts/ingest.py <data_dir> [--resume] [--report-dir reports/]`
  - 흐름: 파일 탐색 → extractor → metadata → chunker → ingestor → progress → reporter
  - 지원 형식: .txt, .pdf, .docx
  - .hwp 발견 시 경고 출력 + 스킵
- [ ] **7.2** 수동 통합 테스트 (사용자에게 실행 요청)

---

## Task 8: 시맨틱 캐시 (선택 — 데이터 적재 후)

> 데이터 적재 완료 후 별도 작업으로 진행. 이번 Phase 2A 범위에서는 제외.

---

## 태스크 요약

| Task | 설명 | 신규 테스트 수 | 필수 |
|------|------|--------------|------|
| T1 | 텍스트 추출 (PDF/DOCX/TXT) | 5 | ✅ |
| T2 | 메타데이터 + source 분류 | 6 | ✅ |
| T3 | 문장 경계 청킹 (kss) | 4 | ✅ |
| T4 | 진행 추적 (progress.json) | 6 | ✅ |
| T5 | Ingestor 개선 | 4 | ✅ |
| T6 | 배치 통계 리포트 | 4 | ✅ |
| T7 | 통합 CLI 스크립트 | 0 (수동) | ✅ |
| T8 | 시맨틱 캐시 | — | ⭐ 별도 |
| **합계** | | **29** | |

---

## 사용자 액션 아이템

파이프라인 코드 완성 후, 사용자가 수행할 작업:

1. **말씀선집 ZIP 9개 해제** → PDF 1,230개를 하나의 폴더에 모으기
2. **원리강론 HWP 60개 → TXT 변환** (한컴에서 일괄 저장)
3. **자서전 HWP 2개 → TXT 변환**
4. **3대경전 HWP 1개 → TXT 변환**
5. 데이터 폴더 구조 유지한 채로 `scripts/ingest.py` 실행
