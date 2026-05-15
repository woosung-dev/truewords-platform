# Phase 2 본 세션 종료 인계 (2026-04-29)

> **다음 세션 시작 시 이 문서부터 읽으세요.** 옵션 B+G 결론 + 다음 단계 (옵션 F 청킹) + 데이터 정합성 chore.

---

## 0. 본 세션 결과 한 줄

**옵션 B (Anthropic Contextual Retrieval) 폐기 권고**. A/B 종료 기준 1/4 PASS, 약점 source M/O가 prefix로 오히려 회귀. 운영 라우팅은 v1으로 복귀 완료. 다음: **옵션 F 청킹 재설계 PoC**가 1순위.

---

## 1. 작업 환경 (다음 세션 점검 명령)

```bash
cd /Users/woosung/project/agy-project/truewords-platform
git checkout feat/phase-2-contextual-retrieval-and-source-ablation
git log --oneline main..HEAD | head -10  # 19 commits

# 라우팅 (이미 v1 복귀됨)
docker exec backend-postgres-1 psql -U truewords -d truewords \
  -c "SELECT chatbot_id, collection_main FROM chatbot_configs WHERE chatbot_id='all';"
# 기대: malssum_poc

# Qdrant 컬렉션 (3개 모두 보존)
curl -sS http://localhost:6333/collections | python3 -m json.tool | grep name
# → malssum_poc (74,341), malssum_poc_v2 (74,341 — 분석 자료로 보존), semantic_cache (0)
```

---

## 2. 본 세션 PR

| PR | 브랜치 | 내용 | 상태 |
|---|---|---|---|
| **#69** | `feat/phase-2-contextual-retrieval-and-source-ablation` | 옵션 B+G 본 가동 + A/B 보고서 | 리뷰 대기 |
| **#70** | `fix/chat-service-mock-regression` | 5건 회귀 fix (PR #68 IntentClassifierStage mock 누락) | 리뷰 대기 |

**머지 순서 권고**: #70 먼저 (main의 회귀 해결) → #69 rebase 후 머지.

---

## 3. 핵심 산출물 위치

### 코드 (브랜치 commit으로 보존)
- `backend/scripts/build_contextual_prefix.py` — concurrent + retry-failed (모델 `gemini-3.1-flash-lite-preview`)
- `backend/scripts/dump_chunks_to_jsonl.py` — Qdrant scroll → 권별 JSONL (NFC 충돌 처리)
- `backend/scripts/reindex_with_prefix.py` — JSONL → ingest_chunks(v2)
- `backend/src/pipeline/chunker.py` + `ingestor.py` — `prefix_text` 필드 + `_build_text_for_embedding`
- `backend/src/chatbot/{models,service}.py` + alembic — `collection_main` 컬럼

### 데이터 (~/Downloads/)
- `contextual_prefixes/` — 96권 / 74,341 prefix JSONL (100% 성공) — 분석 자료로 보존
- `notebooklm_v2_20260428_2338_{light100,cheonilguk50,chambumo50}.xlsx` (3 raw)
- `notebooklm_v2_20260428_2338_category_analysis_*.xlsx` (3 분석)
- `per_source_hit_rate_v2_20260428_2338.xlsx` (per-source 분해)
- `ragas_eval_v2_20260428_2338.xlsx` (RAGAS 4메트릭, 50/50 valid)
- `ragas_eval_seed_50_v2_20260428_2338_*.json` (RAGAS 시드)

### dev-log
- `docs/dev-log/2026-04-28-contextual-retrieval-ab.md` — A/B 통합 보고서 (수치 채워짐)
- `docs/dev-log/2026-04-28-phase-1-eval-report.md` — 옵션 D (이전 세션)
- `docs/dev-log/2026-04-29-session-handoff.md` ← 본 문서

---

## 4. A/B 결론 — 종료 기준 1/4 PASS

| 메트릭 | v1 baseline | v2 prefix | delta | 목표 | PASS? |
|---|---:|---:|---:|---:|:---:|
| RAGAS Faithfulness | 0.546 | 0.597 | +0.051 | ≥ 0.65 | ❌ |
| RAGAS Context Recall | 0.425 | 0.400 | -0.025 | ≥ 0.55 | ❌ |
| NotebookLM L5 | 0.050 | 0.050 | 0 | ≥ 0.12 | ❌ |
| NotebookLM L1 | 0.850 | 0.850 | 0 | 유지 | ✅ |

**Per-source delta**: L +0.133, B +0.018, M -0.107, N -0.266, O -0.118 → 약점 source 회귀 (가설 반증).

**해석 (가설)**: prefix 50~150자가 청크 본연의 키워드 신호를 희석시켰을 가능성. 청크 자체가 짧고 정보 밀도 낮은 경우(M/N/O) prefix가 noise로 작용.

---

## 5. 운영 조치 (이미 완료)

- ✅ 'all' 봇 라우팅을 `malssum_poc_v2` → `malssum_poc` 복귀
- ✅ `semantic_cache` 클리어 (194 → 0 points)
- ✅ `malssum_poc_v2` 컬렉션 보존 (분석 자료로 재사용)

---

## 6. 다음 세션 우선순위 작업

### #1 ★★★★★ 옵션 F: 청킹 재설계 PoC

**가설**: prefix가 noise였던 이유는 청크 자체가 짧고 정보 밀도가 낮음. 청킹을 재설계하면 prefix 없이도 검색 정확도 향상 가능.

**1권 PoC 설계**:
1. 평화경.txt (7,869 청크) 또는 천성경 (7,418 청크) 1권 sample
2. 청킹 방식 3종 비교:
   - 현행 sentence-based kss (baseline)
   - token-based 1024 (LangChain RecursiveCharacterTextSplitter, chunk_overlap 200)
   - paragraph-based (빈 줄 기준)
3. 각 방식으로 별도 컬렉션 (`malssum_chunking_pocN`) 생성 → NotebookLM 50건 sample 측정
4. hit율 + Faithfulness 비교

**파일 위치 권고**:
- `backend/scripts/chunking_poc.py` (신규)
- `docs/dev-log/2026-04-29-chunking-poc.md` (보고서)

### #2 ★★★ 옵션 H: citation_metrics PoC

**목적**: Faithfulness 0.597의 source-level 분해. 어떤 source가 답변 정확도를 깎는지 추적.

**구현**:
- `backend/scripts/citation_metrics.py` 신규
- `/chat` 응답의 `sources[]`와 답변 텍스트의 인용 패턴 매칭
- citation coverage = (cited sources / 응답에 사용된 모든 출처) 비율
- unsupported claim rate = (출처 없는 사실 주장 / 전체 사실 주장)

### #3 ★★★ 데이터 정합성 chore PR

**대상 (별도 chore PR로 분리)**:
1. NFC/NFD 중복 권명 정리:
   - `말씀선집 002권.pdf` × 2 (NFC/NFD)
   - `11월 2일 참어머님 말씀.txt` × 2 (NFC/NFD)
   - 정책: NFC로 통일 (Linux/macOS 호환)
2. 이중 prefix 권 정리:
   - `말씀선집 말씀선집 001~005권.pdf` × 5 (총 ~4,500 청크)
   - 같은 내용이 다른 권명으로 두 번 적재됨 (`말씀선집 001권.pdf`와 중복)
   - 정책: 이중 prefix 권 5건 삭제

**도구**: `backend/scripts/dedupe_volumes.py` (신규) — Qdrant scroll + Filter delete + reindex.

### #4 ★★ 옵션 B v2 어블레이션 (보류 권고)

prefix 길이 50자 단축 / source-specific prompt 등 변형. 본 A/B에서 prefix 자체가 noise라는 신호가 강해 ROI 낮음.

---

## 7. 본 세션 핵심 발견 (메모리 가치 있음)

### 7.1 모델별 RPD quota 분리
- Gemini API의 RPM/TPM/RPD는 **모델별로 분리** (paid tier 기준)
- gemini-2.5-flash: RPD 10K/일
- gemini-3.1-flash-lite-preview: RPD **150K/일** (15배)
- gemini-embedding-001: RPD **무제한**
- 향후 LLM 호출 많은 작업은 모델 선택을 quota 기준으로 우선 검토

### 7.2 RAGAS 0.4.3 hang 자동 해결 조건
- `GEMINI_TIER=paid` + `LangchainLLMWrapper` default config
- timeout 50/50 → 0/50 (paid tier 만으로 해결)
- 이전 세션 §7 미완 항목 종결

### 7.3 macOS FS NFC/NFD auto-merge
- macOS는 파일경로를 NFD로 정규화하지만 사용자 코드에서는 NFC/NFD 둘 다 통과
- Python set으로 dedup 시 NFC 정규화 필수
- 본 세션 dump_chunks_to_jsonl.py에 처리 로직 추가됨 (재사용 가능)

### 7.4 retry-failed 패턴
- 큰 작업에서 부분 실패 → 재시도가 일반적 패턴
- in-place 갱신 (성공 청크 보존) + Semaphore 동시성 제한
- 본 세션 9회 누적 retry로 64K 실패 → 0건 도달
- 향후 비슷한 LLM 대량 작업에 동일 패턴 재사용

---

## 8. push / PR 정책 (메모리 룰)

- main에 직접 commit/push 금지 ✓
- feature 브랜치 commit 자율 ✓ (19 commits 진행)
- **push + `gh pr create`는 사용자 승인 필요** ✓ (본 세션 사용자 승인 받고 PR #69, #70 생성 완료)

본 인계 문서를 다음 세션 시작 시 다시 읽고 옵션 F 진행.
