# Phase 3: 데이터 파이프라인 스케일 설계 스펙

> 작성일: 2026-03-28
> Phase 1 완료 기준: POST /chat API, 1권 206 청크 적재, 24 테스트 통과

---

## 1. 목표와 성공 기준

### 목표
615권 말씀선집 전체를 안정적으로 Qdrant에 적재할 수 있는 **산업 강도(production-grade) 데이터 파이프라인** 구축

### 성공 기준

| # | 기준 | 측정 방법 |
|---|------|----------|
| S1 | 615권 전체 적재 완료 | Qdrant collection 점 수 = 전체 청크 수 |
| S2 | 중단 후 재개 시 이미 적재된 권 스킵 | progress.json 기반 증분 적재 테스트 |
| S3 | 권별 메타데이터 (권번호, 제목, 날짜) 검색 가능 | Qdrant payload 필터 쿼리로 검증 |
| S4 | 동일/유사 질의 캐시 히트율 > 0% (기능 동작) | 시맨틱 캐시 collection 존재 + 히트 테스트 |
| S5 | HWP 파일 → TXT 변환 자동화 | scripts/convert_hwp.py 실행으로 .txt 생성 |
| S6 | 배치 완료 후 통계 리포트 JSON 생성 | reports/ 디렉토리에 파일 존재 |
| S7 | 기존 24개 테스트 + 신규 테스트 전부 통과 | pytest 전체 통과 |

---

## 2. 설계 결정 + 트레이드오프

### 2.1 청킹 전략

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| **A. 문단 기반 (현재)** | 구현 단순, 문단 경계 보존 | 문단 길이 불균일, 의미 단위 무시 | - |
| **B. 문장 경계 보존** | 문장 완성도 유지, 구현 적당 | 한국어 문장 분리 정확도 이슈 | **채택** |
| **C. 의미 단위 (LLM 기반)** | 최고 품질 | 615권 처리 비용 폭발, 속도 느림 | Phase 4+ |

**결정: B. 문장 경계 보존 청킹**
- `kss` (Korean Sentence Splitter) 라이브러리로 한국어 문장 분리
- 문장 단위로 누적하여 `max_chars` (500자) 초과 시 새 청크
- 오버랩: 마지막 1~2 문장을 다음 청크에 포함
- 기존 `Chunk` dataclass에 `title`, `date` 필드 추가 (optional)

### 2.2 시맨틱 캐시

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| **A. Qdrant separate collection** | 기존 인프라 재활용, 벡터 유사도 검색 네이티브 | Qdrant 의존 | **채택** |
| **B. Redis** | 빠름, TTL 네이티브 | 벡터 검색 별도 구현 필요, 추가 인프라 | - |
| **C. 파일 (JSON)** | 의존성 없음 | 벡터 검색 불가, 스케일 불가 | - |

**결정: A. Qdrant `semantic_cache` collection**
- 기존 `08-semantic-cache.md` 설계 그대로 적용
- `score_threshold=0.93`, TTL 7일 (payload `created_at` 필터)
- 캐시 히트 시 즉시 반환, 미스 시 정상 RAG + 결과 캐싱
- **벡터 설정:** `semantic_cache` 컬렉션은 메인 컬렉션과 동일한 `gemini-embedding-001` (3072 dims) dense 벡터를 사용한다. sparse 벡터는 캐시에 불필요하므로 dense only.

### 2.3 HWP 변환

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| **A. hwp5txt** | Python 네이티브, pip install | HWP5 포맷만 지원 (HWPX 미지원) | **1차 채택** |
| **B. libreoffice CLI** | HWP/HWPX 모두 지원 | 시스템 의존, Docker 필요 | 폴백 |
| **C. 외부 API** | 안정적 | 비용, 네트워크 의존 | - |

**결정: A (hwp5txt) + B (libreoffice) 폴백 체인**
- hwp5txt 시도 → 실패 시 libreoffice CLI → 실패 시 에러 로그 + 스킵
- 이미 .txt 파일 존재 시 변환 스킵

### 2.4 진행 추적

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| **A. JSON 파일** | 구현 단순, 디버깅 쉬움, Git 추적 가능 | 동시 쓰기 이슈 (단일 프로세스라 무관) | **채택** |
| **B. SQLite** | 트랜잭션 보장 | 과도한 복잡도 | - |
| **C. Qdrant metadata** | 추가 파일 없음 | 쿼리 복잡, 적재 상태와 데이터 혼재 | - |

**결정: A. JSON 파일 (`progress.json`)**
```json
{
  "started_at": "2026-03-28T10:00:00",
  "updated_at": "2026-03-28T12:30:00",
  "completed_volumes": ["vol_001", "vol_002"],
  "failed_volumes": {"vol_003": "HWP 변환 실패"},
  "current_volume": null,
  "total_chunks": 12345,
  "total_time_sec": 3600
}
```

### 2.5 Gemini Rate Limit 대응

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| **A. 지연 시간 조절 (현재 0.2s)** | 무료 티어 유지 | 615권 적재 시간 매우 김 | **기본** |
| **B. 배치 임베딩 API** | 처리량 증가 | Gemini batch embed 미지원 확인 필요 | **조사 후 적용** |
| **C. 유료 전환** | rate limit 완화 | 비용 발생 | 사용자 결정 |

**결정: A + 지수 백오프 개선**
- 현재: 고정 60초 대기 → 개선: 지수 백오프 (30s → 60s → 120s)
- `embed_delay` 설정 파일로 외부화 (환경 변수)
- Gemini `embed_content`는 단건 API이므로 배치는 클라이언트 측 동시 처리로 대체 불가 (rate limit 때문)
- 예상 적재 시간: 하단 "데이터 규모 추정" 참조

---

## 3. 범위 제한 (NOT in scope)

| 항목 | 이유 |
|------|------|
| 계층적 청킹 (parent_chunk_id) | Phase 4에서 검색 고도화와 함께 도입 |
| Re-ranking 파이프라인 | Phase 4 검색 품질 개선 |
| Query Expansion / Rewriting | Phase 4 검색 품질 개선 |
| Agentic RAG | Phase 5 |
| 멀티 챗봇 (chatbot_id별 캐시 분리) | Phase 4+ |
| 클라우드 배포 | Phase 4 |
| POST /chat API 응답 스키마 변경 | 응답 스키마 불변 — 내부 구현(캐시 체크/저장)은 변경됨 |
| 프론트엔드 UI | 별도 Phase |
| BM25 인덱스 재구축 | 기존 fastembed BM25 유지 |

---

## 4. 의존성 분석

### 수정 대상 (기존 코드)

| 파일 | 변경 내용 |
|------|----------|
| `src/pipeline/chunker.py` | 문장 경계 청킹, `Chunk` dataclass에 `title`/`date` 필드 추가 |
| `src/pipeline/ingestor.py` | 메타데이터 강화 payload, 증분 적재 로직, 지수 백오프 |
| `src/config.py` | `embed_delay`, `cache_collection_name`, `progress_file` 설정 추가 |
| `scripts/ingest.py` | 진행 추적, 배치 통계, HWP→TXT 변환 통합 |
| `src/qdrant_client.py` | `semantic_cache` collection 생성 함수 추가 |
| `tests/test_chunker.py` | 문장 경계 청킹 테스트 추가 |
| `tests/test_ingestor.py` | 증분 적재, 메타데이터, 통계 테스트 추가 |

### 신규 생성

| 파일 | 역할 |
|------|------|
| `src/pipeline/converter.py` | HWP→TXT 변환 모듈 |
| `src/pipeline/progress.py` | 진행 상황 JSON 추적 모듈 |
| `src/pipeline/metadata.py` | 파일명/내용에서 메타데이터 추출 |
| `src/cache/semantic_cache.py` | 시맨틱 캐시 조회/저장 |
| `src/pipeline/reporter.py` | 배치 통계 리포트 생성 |
| `scripts/convert_hwp.py` | HWP→TXT 변환 CLI 스크립트 |
| `tests/test_converter.py` | HWP 변환 테스트 |
| `tests/test_progress.py` | 진행 추적 테스트 |
| `tests/test_metadata.py` | 메타데이터 추출 테스트 |
| `tests/test_semantic_cache.py` | 시맨틱 캐시 테스트 |
| `tests/test_reporter.py` | 리포트 생성 테스트 |

---

## 5. 데이터 규모 추정

### 청크 수 추정

| 항목 | 값 | 근거 |
|------|-----|------|
| 1권당 평균 청크 수 | ~200개 | 1권(축복행정 규정집) = 206 청크 |
| 전체 권 수 | 615권 | |
| **예상 총 청크 수** | **~123,000개** | 615 x 200 |
| 실제 범위 | 80,000 ~ 180,000 | 권마다 분량 차이 큼 |

### 임베딩 시간 추정

| 항목 | 값 |
|------|-----|
| 청크 1개 임베딩 시간 | ~0.3초 (API 호출 + 0.2초 지연) |
| 123,000 청크 | 123,000 x 0.3 = **36,900초 = ~10.25시간** |
| rate limit 429 재시도 포함 | **~12~15시간** |
| BM25 로컬 임베딩 | 무시 가능 (ms 단위) |

### 스토리지 추정

| 항목 | 값 |
|------|-----|
| 청크당 dense 벡터 | 3072 x 4 bytes = 12KB |
| 123,000 청크 dense | ~1.5GB |
| sparse 벡터 + payload | ~0.5GB |
| **총 Qdrant 스토리지** | **~2GB** |

---

## 6. 리스크 + 완화 전략

| # | 리스크 | 영향 | 확률 | 완화 전략 |
|---|--------|------|------|----------|
| R1 | Gemini 429 연속 발생으로 적재 중단 | 높음 | 높음 | 지수 백오프 + progress.json 중단점 복원 |
| R2 | HWP 파일 인코딩 깨짐 | 중간 | 중간 | hwp5txt + libreoffice 폴백 + 실패 로그 |
| R3 | 디스크 부족 (Qdrant 2GB+) | 높음 | 낮음 | 적재 전 디스크 여유 확인, Docker volume 경로 설정 |
| R4 | 중복 적재 (동일 권 재적재) | 중간 | 중간 | progress.json의 completed_volumes 체크 |
| R5 | 네트워크 끊김 (Gemini API) | 높음 | 중간 | 재시도 로직 + 중단점 복원 |
| R6 | kss 한국어 문장 분리 정확도 | 낮음 | 중간 | 종교 텍스트 샘플 테스트, 필요 시 정규식 폴백 |
| R7 | 시맨틱 캐시 임계값 부적절 | 낮음 | 중간 | 0.93 보수적 설정 + 로그 기반 튜닝 |
| R8 | Phase 1 테스트 깨짐 | 높음 | 낮음 | 기존 Chunk dataclass 하위 호환 유지 |

---

## 7. 아키텍처 다이어그램

```
[HWP/TXT 원본 파일]
        │
        ▼
  ┌─────────────┐
  │ converter   │  HWP → TXT (hwp5txt / libreoffice)
  └──────┬──────┘
         │ .txt
         ▼
  ┌─────────────┐
  │ metadata    │  파일명 → 권번호, 제목, 날짜 추출
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ chunker     │  문장 경계 청킹 (kss + max_chars)
  └──────┬──────┘
         │ Chunk[]
         ▼
  ┌─────────────┐
  │ ingestor    │  embed (dense+sparse) → Qdrant upsert
  │             │  + progress.json 업데이트
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ reporter    │  배치 통계 JSON 생성
  └─────────────┘

  [별도] semantic_cache → Qdrant "semantic_cache" collection
         POST /chat 요청 시 캐시 체크/저장
```
