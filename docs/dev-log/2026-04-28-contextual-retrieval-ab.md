# Phase 2 옵션 B (Contextual Retrieval) + G (Source Ablation) — A/B 통합 보고서

> **세션**: 2026-04-28 ~ 2026-04-29 (Phase 2 본 세션)
> **브랜치**: `feat/phase-2-contextual-retrieval-and-source-ablation`
> **베이스라인**: 옵션 D 측정 (`docs/dev-log/2026-04-28-phase-1-eval-report.md`)
> **A/B**: `malssum_poc` (v1 baseline) vs `malssum_poc_v2` (Anthropic Contextual Retrieval prefix prepended)

---

## 0. 한 줄 결론

**Mixed result — 종료 기준 4 중 1 PASS**. Faithfulness 소폭 개선 (+0.051), Context Recall 소폭 회귀 (-0.025), L5 정체. 약점 source M/O는 prefix로 오히려 회귀. 옵션 B 단독 효과는 약점 정확도 향상에 충분치 않음 → 옵션 F (청킹) 또는 source-specific 튜닝 후속 권장.

---

## 1. 산출물

### 코드 (이 브랜치 commit으로 보존)
- `backend/scripts/build_contextual_prefix.py` — concurrent mode (asyncio.Semaphore + as_completed) + retry-failed 모드 (in-place 갱신)
- `backend/scripts/dump_chunks_to_jsonl.py` — Qdrant scroll → 권별 JSONL (NFC 충돌 처리 포함)
- `backend/scripts/reindex_with_prefix.py` — JSONL → Chunk → ingest_chunks(v2) (prev session)
- `backend/src/pipeline/chunker.py` — `Chunk.prefix_text` 필드 (prev session)
- `backend/src/pipeline/ingestor.py` — `_build_text_for_embedding` prefix prepend (prev session)
- `backend/src/chatbot/{models,service}.py` + alembic 마이그레이션 — `collection_main` 컬럼 (prev session)

### 단위 테스트 (PASS)
- 이전 세션 16개 + 본 세션 신규: build_contextual_prefix concurrent 3 + retry-failed 3 + dump_chunks 7 + chatbot stub fix 8 = **37개 PASS**

### 데이터 (`~/Downloads/`)
- `contextual_prefixes/` — 96권 / 74,341 prefix JSONL (gemini-3.1-flash-lite-preview, retry 9회 누적)
- `ragas_eval_v2_20260428_2338.xlsx` — 50건 RAGAS 4메트릭 (50/50 valid)
- `notebooklm_v2_20260428_2338_{light100,cheonilguk50,chambumo50}.xlsx` (3 raw)
- `notebooklm_v2_20260428_2338_category_analysis_*.xlsx` (3 분석)
- `per_source_hit_rate_v2_20260428_2338.xlsx` (옵션 G 분해)

### Qdrant 컬렉션
- `malssum_poc` (v1 baseline): 74,341 points (사용자 데이터 기존 그대로)
- `malssum_poc_v2` (treatment): 74,341 points, prefix prepended embedding ✓ 1:1 일치

### A/B 라우팅
- `chatbot_configs.collection_main`로 봇별 컬렉션 토글
- 'all' 봇 → `malssum_poc_v2` (A/B 측정 동안)

---

## 2. 데이터 환경 발견 (핵심)

### 인계서 "615권" 정정 → **96권** 74,341청크
- malssum_poc 실측: 96 unique volumes
- 상위 5: 평화경(7869) + 천성경(7418) + 통일사상(2441) + 원리강론(1937) + 참어머님 말씀모음(1391)
- 권 분포: 말씀선집 001~030 (30권) + 말씀선집 말씀선집 001~005 (이중 prefix 권 5건 — 데이터 정합성 문제) + 그 외 종류별 단일권 + 참어머님 말씀 시리즈

### NFC/NFD 중복 데이터 발견
- 2건 권명이 NFC/NFD 두 형태로 적재됨 (각 동일 청크 수):
  - `말씀선집 002권.pdf` × 2 (각 855청크)
  - `11월 2일 참어머님 말씀.txt` × 2 (각 5청크)
- 본 작업의 dump_chunks_to_jsonl.py는 `_dup1` 접미사로 모두 보존 → 재인덱싱 시에도 동일 청크가 v2에 그대로 적재되어 A/B 형평성 유지.
- **후속 권고**: malssum_poc 데이터 정합성 점검 (NFC/NFD 통일, 중복 권 정리) 별도 chore PR.

---

## 3. 종료 기준 4메트릭 표

| 메트릭 | baseline (옵션 D) | v2 (Contextual) | 목표 | 결과 |
|---|---:|---:|---:|:---:|
| RAGAS Faithfulness | 0.546 | **0.597** | ≥ 0.65 | ❌ |
| RAGAS Context Recall | 0.425 | 0.400 | ≥ 0.55 | ❌ |
| NotebookLM L5 hit율 | 0.050 | 0.050 | ≥ 0.12 | ❌ |
| NotebookLM L1 hit율 | 0.850 | 0.850 | 유지 (≥ 0.85) | ✅ |

**1/4 PASS — 종료 기준 미달.**

추가 RAGAS 메트릭 (참고):
| 메트릭 | v2 | 비고 |
|---|---:|---|
| Context Precision | 0.653 | 첫 측정 (v1 미측정) |
| Answer Relevancy | 0.808 | 첫 측정 (v1 미측정) |

**RAGAS 측정 품질**: 50/50 valid (timeout 0건). paid tier로 RAGAS 0.4.3 hang 이슈 해결됨.

---

## 4. NotebookLM 200 카테고리 분해 (v1 4/27 튜닝후 vs v2 prefix)

### Light + 통일원리 100건 (Level별)

| Level | n | baseline | v2 | delta |
|---|---:|---:|---:|---:|
| L1 단순 사실 조회 | 20 | 0.850 | 0.850 | +0.000 |
| L2 출처 인용 | 20 | 0.850 | 0.800 | -0.050 |
| L3 주제 요약 | 20 | 0.600 | 0.550 | -0.050 |
| L4 개념 연결 | 20 | 0.450 | 0.450 | +0.000 |
| L5 교리 추론 | 20 | 0.050 | 0.050 | **+0.000** |

회귀 7건 / 개선 5건. L5 정체 (옵션 D와 동일).

### 천일국 50건 (질문 성향별)

| 카테고리 | n | baseline | v2 | delta |
|---|---:|---:|---:|---:|
| 긍정적 | 10 | 0.300 | 0.500 | **+0.200** ✓ |
| 부정적 | 20 | 0.200 | 0.150 | -0.050 |
| 평균적 | 20 | 0.450 | 0.350 | -0.100 |

긍정적 질문에서만 prefix 효과 가시화.

### 참부모 50건 (질문 수준별)

| 카테고리 | n | baseline | v2 | delta |
|---|---:|---:|---:|---:|
| 간단 | 20 | 0.400 | 0.300 | -0.100 |
| 보통 | 20 | 0.350 | 0.250 | -0.100 |
| 상세 | 10 | 0.300 | 0.300 | +0.000 |

전반적 회귀.

---

## 5. 옵션 G — Source Ablation (per-source hit율, v1 옵션 D vs v2)

| Source | n_chunks | baseline hit율 | v2 hit율 | delta |
|---|---:|---:|---:|---:|
| **L** (특정 source 청크) | 38 | 0.472 | 0.605 | **+0.133** ✓ |
| **B** (어머니말씀 모음) | 65 | 0.397 | 0.415 | +0.018 |
| **M** (3대 경전) | 59 | 0.531 | 0.424 | **-0.107** ↓ |
| **O** (말씀선집 권) | 15 | 0.385 | 0.267 | -0.118 |
| **N** | 22 | 0.448 | 0.182 | **-0.266** ↓↓ |

**해석**:
- prefix는 일부 source(L, B)에서 약간 도움 — Mixed signal
- **약점 source M/O가 더 나빠짐** — 인계서 옵션 D 가설("M+O+B 약점 = prefix 적용 후 회복")의 **반증**
- N 26.6% 회귀 — prefix가 일부 source에는 noise로 작용

**가설**: prefix 생성 시 chunk 단위로 8000자 full_doc context를 압축한 한두 문장이 검색 임베딩에 더해지며, 청크 본연의 키워드 신호를 희석시켰을 수 있음. 정밀 분석 (옵션 F 청킹 비교 + prefix 길이/내용 어블레이션) 필요.

---

## 6. 의사결정 다이어리 (★ = 추천도)

| 결정 | 시각 | 추천도 | 이유 |
|---|---|---|---|
| Gemini Batch API 우회 (Plan §Task 12a 대신 asyncio.Semaphore + gather) | 14:08 | ★★★★★ | `GEMINI_TIER=paid` 라 RPM 충분 가정. 코드 변경 최소화 |
| 인계서 "615권" → 실측 "96권" 갱신 | 14:15 | ★★★★★ | malssum_poc scroll 결과 정확한 사이즈 확인 |
| concurrency 20 → 60 상향 | 14:24 | ★★★ | throughput 향상이지만 burst quota 도달 위험 (실제 발생) |
| NFC/NFD 중복 권명 보존 (`_dup1`) | 14:22 | ★★★★★ | macOS FS auto-merge로 860청크 손실 방지 |
| 회귀 PR 분리 | 14:00 | ★★★★★ | 본 작업과 무관, blast radius 분리 |
| RAGAS 0.4.3 hang 디버깅 보류 | 14:25 | ★★★★ | paid tier에서 자동 해결 (50/50 valid 결과로 검증됨) |
| **모델 변경: gemini-2.5-flash → gemini-3.1-flash-lite-preview** | 17:18 | ★★★★★ | 사용자 dashboard 점검 결과 RPD 10K vs 150K 큰 차이. 프로젝트 표준(`MODEL_GENERATE`) 일치. **본 세션 핵심 발견** |
| `--retry-failed` 모드 신규 도입 | 17:00 | ★★★★★ | 부분 실패 청크만 재시도, 비용·시간 절감. 9회 retry로 100% 도달 |
| concurrency 60 → 30 → 10 점진 감소 | 21:54 | ★★★★ | quota burst 회피 + 안정적 진행 |
| RAGAS LLM 모델 `gemini-2.5-pro` 유지 | 00:24 | ★★★★ | paid tier로 timeout 해결 검증, 모델 변경 위험 회피 |
| sample_eval_pairs 입력에 v2 xlsx symlink 매핑 | 00:24 | ★★★★★ | 코드 변경 없이 v2 시드 생성, ALLOCATION 호환 |
| 분석 baseline=4/27 튜닝후 사용 (옵션 D 측정 후 아닌) | 00:13 | ★★★★ | prefix 효과 분리 측정 (액션 1+2+3 ON 동일 조건) |

---

## 7. 다음 단계 (Phase 3 분기 결정)

### 즉시 (본 PR 머지 후)
- [ ] 회귀 fix PR 머지 (`fix/chat-service-mock-regression` 브랜치 a38da1e) — 본 작업과 무관, 별도 PR
- [ ] malssum_poc NFC/NFD 중복 데이터 정합성 chore PR (선택)

### Phase 2 잔여 (B/G 외 — 본 결과로 우선순위 갱신)
- [ ] **★★★★★ 옵션 F: 청킹 재설계** — sentence-based 1024 vs token-based 비교. prefix가 작은 청크에 noise였을 가능성 검증
- [ ] **★★★★ source-specific tuning** — M/O 약점은 prefix로 회복 안 됨 → source-specific prompt or chunking 차별화
- [ ] **★★★ 옵션 H: citation_metrics.py PoC** — Faithfulness 0.597을 어디서 깎아먹는지 추적
- [ ] **★★ 옵션 B v2: prefix 길이/스타일 어블레이션** — 현 50~150자 한국어 한두 문장이 길어서 noise일 가능성

### Phase 3 (분기 결정)
- 옵션 B 결과를 본 분석으로 **분기 #2 (B+G 병행)는 부분 효과만 확인** — full Phase 3 진입 보류
- **권고: 옵션 F 청킹 검증 → 분기 #3 (옵션 F+B 결합) 또는 prefix 폐기**

---

## 8. 재현 가이드

### Prefix 생성 (전체 플로우)
```bash
cd backend
# 1. dump
PYTHONPATH=. uv run python scripts/dump_chunks_to_jsonl.py \
    --collection malssum_poc --output-dir /tmp/all_chunks_jsonl
# 2. prefix 생성 (concurrency 20~30 권장)
PYTHONUNBUFFERED=1 PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
    --input-dir /tmp/all_chunks_jsonl \
    --output-dir ~/Downloads/contextual_prefixes \
    --mode concurrent --concurrency 20
# 3. 부분 실패 시 retry-failed 모드 (본 세션 9회 누적)
PYTHONUNBUFFERED=1 PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
    --output-dir ~/Downloads/contextual_prefixes \
    --retry-failed --concurrency 10
```

### v2 재인덱싱 + A/B 토글
```bash
PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \
    --input-dir ~/Downloads/contextual_prefixes
# semantic_cache 비우기
PYTHONPATH=. uv run python -c "
from src.qdrant_client import get_client
from qdrant_client.models import FilterSelector, Filter
c = get_client()
c.delete(collection_name='semantic_cache', points_selector=FilterSelector(filter=Filter()))
"
docker exec backend-postgres-1 psql -U truewords -d truewords -c \
    "UPDATE chatbot_configs SET collection_main='malssum_poc_v2' WHERE chatbot_id='all';"
```

### NotebookLM 200 v2
```bash
DATE=$(date "+%Y%m%d_%H%M")
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
    --light  "~/Downloads/Light RAG 성능 평가를 위한 단계별 테스트 Q&A 50선.xlsx" \
    --level5 "~/Downloads/통일원리 및 RAG 성능 평가용 5단계 숙련도 테스트 세트.xlsx" \
    --output ~/Downloads/notebooklm_v2_${DATE}_light100.xlsx \
    --chatbot-id all --api-base http://localhost:8000
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
    --input "~/Downloads/천일국 섭리 승리를 위한 신앙 문답 가이드.xlsx" \
    --output ~/Downloads/notebooklm_v2_${DATE}_cheonilguk50.xlsx \
    --chatbot-id all --api-base http://localhost:8000
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
    --input "~/Downloads/참부모 섭리와 신앙 생활 단계별 Q&A 데이터셋.xlsx" \
    --output ~/Downloads/notebooklm_v2_${DATE}_chambumo50.xlsx \
    --chatbot-id all --api-base http://localhost:8000
```

### 분석 (3 카테고리 + per-source)
```bash
DATE="<측정시각>"
for SET in light100 cheonilguk50 chambumo50; do
    BASELINE=$(case $SET in
        light100) echo "/Users/woosung/Downloads/notebooklm_qa_전체검색봇_평가_튜닝후_20260427_1649.xlsx";;
        cheonilguk50) echo "/Users/woosung/Downloads/천일국섭리_튜닝후.xlsx";;
        chambumo50) echo "/Users/woosung/Downloads/참부모섭리_튜닝후.xlsx";;
    esac)
    PYTHONPATH=. uv run python scripts/analyze_notebooklm_categories.py \
        --baseline "$BASELINE" \
        --treatment "/Users/woosung/Downloads/notebooklm_v2_${DATE}_${SET}.xlsx" \
        --output "/Users/woosung/Downloads/notebooklm_v2_${DATE}_category_analysis_${SET}.xlsx"
done
PYTHONPATH=. uv run python scripts/analyze_per_source_hit_rate.py \
    --input ~/Downloads/notebooklm_v2_${DATE}_*.xlsx \
    --output ~/Downloads/per_source_hit_rate_v2_${DATE}.xlsx
```

### RAGAS v2
```bash
# v2 xlsx를 ALLOCATION 이름으로 symlink (sample_eval_pairs 호환)
mkdir -p /tmp/v2_eval_input
ln -sf "~/Downloads/notebooklm_v2_${DATE}_light100.xlsx" \
    "/tmp/v2_eval_input/notebooklm_qa_전체검색봇_평가_튜닝후_20260427_1649.xlsx"
ln -sf "~/Downloads/notebooklm_v2_${DATE}_cheonilguk50.xlsx" \
    "/tmp/v2_eval_input/천일국섭리_튜닝후.xlsx"
ln -sf "~/Downloads/notebooklm_v2_${DATE}_chambumo50.xlsx" \
    "/tmp/v2_eval_input/참부모섭리_튜닝후.xlsx"
PYTHONPATH=. uv run python scripts/sample_eval_pairs.py \
    --input-dir /tmp/v2_eval_input --output-dir ~/Downloads \
    --prefix ragas_eval_seed_50_v2_${DATE}
SEED=$(ls -t ~/Downloads/ragas_eval_seed_50_v2_${DATE}*.json | head -1)
PYTHONPATH=. uv run --group eval python scripts/eval_ragas.py \
    --seed "$SEED" --output ~/Downloads/ragas_eval_v2_${DATE}.xlsx
```
