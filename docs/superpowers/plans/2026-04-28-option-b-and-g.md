# Option B (Contextual Retrieval) + G (Source-weight Ablation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anthropic Contextual Retrieval(615권 18만 청크에 50~100토큰 contextual prefix 부여 후 새 컬렉션 `malssum_poc_v2`에 재인덱싱)와 Source-weight Ablation(50건 시드에 ground-truth source 라벨링 + per-source 4메트릭 매트릭스)를 결합 진행. G는 B의 contextual prefix 우선순위 결정 입력으로 먼저 끝낸 뒤 약점 source부터 prefix 적용. 종료 시 RAGAS Faithfulness 0.546→0.65+, Context Recall 0.425→0.55+, NotebookLM L5 12%+ 회복을 검증.

**Architecture:** (1) Group A "G PoC" 0.5~1일 → 약점 source 식별 → (2) Group B "B 인프라" 1일 (Chunk.prefix_text + ChatbotConfig.collection_main + admin UI) → (3) Group C "Prefix 생성" 3~5일 (build_contextual_prefix.py + Gemini Flash batch) → (4) Group D "재인덱싱" 1일 (malssum_poc_v2 + reindex_with_prefix.py) → (5) Group E "A/B 평가" 0.5일 (RAGAS 50 v1 vs v2 + NotebookLM 200 v2) → (6) Group F "정리·PR" 0.5일. 본 plan은 본 세션의 옵션 D 직후 분기 #2 결정에 따라 분기됨 (`docs/dev-log/2026-04-28-phase-1-eval-report.md`). main HEAD `c2bb05b` 자체의 5건 chat_service/stream_abort 회귀는 본 plan과 별도 PR로 처리.

**Tech Stack:** Python 3.12 + uv, FastAPI, SQLModel + Alembic, Qdrant `AsyncQdrantClient` (dense 1536 COSINE + sparse on_disk=False), Gemini 2.5 Flash batch (`google-genai` SDK), RAGAS 0.4.x with `gemini-2.5-pro` 평가, openpyxl, pytest, Next.js 16 admin (`features/chatbot/components/chatbot-form.tsx`).

---

## Context — 왜 이 일을 하는가

본 세션 옵션 D 결과 (`docs/dev-log/2026-04-28-phase-1-eval-report.md`):

| Level | n | baseline | treatment | delta |
|---|---:|---:|---:|---:|
| L1 단순 사실 (Light+통일원리) | 20 | 0.850 | 0.850 | +0.000 ✓ |
| **L5 교리 추론** | 20 | **0.050** | **0.050** | **+0.000 ✗** |
| 천일국 부정적 | 20 | 0.200 | 0.100 | −0.100 |
| 참부모 간단/보통 | 40 | 0.375 | 0.325 | −0.050 |

L1 유지 + L5 회복 실패 + 카테고리 5건 소폭 회귀 → 인계서 §4-D 분기 #2 "B + G 병행".

**왜 G를 먼저:** 'all' 봇 weighted_sources B/L/M/N/O 5개가 균등 weight 1.0인데 어느 source가 L5 5%/천일국 부정적 회귀를 끌어내리는지 모름. G PoC(0.5~1일)로 약점 source를 식별한 뒤 B의 contextual prefix를 약점 source에 우선 집중하면 5~7일 B 작업의 효율을 크게 높일 수 있음 (인계서 §4-G "B와 시너지").

**왜 B 본질:** L5 (교리 추론)이 0.05에 정체된 건 retrieval candidate quality 자체의 한계. 액션 1+2+3(IntentClassifier + system_prompt 재정의 + RAGAS 평가)는 prompt-layer 개선이라 retrieval 품질을 안 건드림. Anthropic 검증치: Contextual Embeddings 단독 retrieval failure −35% / +Contextual BM25 −49% / +Reranking −67% (5.7%→1.9%).

**비용**: 615권 × 평균 300청크/권 ≈ **18만 청크** × Gemini Flash batch ≈ **$10~50 일회성** (인계서 §4-B). Free tier 임베딩(60s/배치)은 이미 운영 중이므로 추가 비용 없음.

---

## Phase 1 탐색 결과 요약 (read-only)

### 인덱싱 파이프라인 (`backend/src/pipeline/`)

- `chunker.py:16-24` — `Chunk` 데이터클래스: `text`, `volume`, `chunk_index`, `source: list[str] | str`, `title`, `date`. **`prefix_text` 추가 필요**.
- `ingestor.py:78-237` — `ingest_chunks(client, collection_name, chunks, start_chunk, title, on_progress, payload_sources)` — collection_name 인자, 라인 154 batch text build, 라인 178~197 PointStruct 조립 (UUID5 point_id, `QdrantChunkPayload.model_dump()` payload). **prefix prepend hook은 라인 154**.
- `batch_embedder.py` + `batch_service.py:111-171` — Gemini Batch API JSONL 입력 (`{"contents": text, "config": {...}}`), `BatchJob` 테이블 체크포인트.
- `embedder.py:25` `MAX_TEXTS_PER_BATCH = 100`, `config.py:65` `embed_max_chars_per_batch = 31000` (free), `:66` `embed_batch_sleep = 60.0`. 18만 청크 ≈ **1800배치 × 60s = 30시간** (free tier).
- `extractor.py:9-44` — 단일 문자열 반환 (PDF는 페이지 접합).
- `qdrant_client.py:30-41` `create_collection()` 헬퍼 (dense 1536 COSINE + sparse on_disk=False + payload indexes source/volume KEYWORD).
- `scripts/ingest.py:6-14` — CLI `ingest.py <data_dir> [--resume] [--report-dir reports/]`.

### Chatbot 설정 (`backend/src/chatbot/`)

- `models.py:25` — `ChatbotConfig.search_tiers: dict (JSON)`. 구조: `{search_mode, tiers, weighted_sources: [{source, weight, score_threshold}], dictionary_enabled, query_rewrite_enabled}` (`add_categories_and_bots.py:168-180`).
- 'all' 봇 weighted_sources: `[B, L, M, N, O]` weight 1.0, score_threshold 0.10.
- Source 코드: A/B/L/D/M/N/O 구 + P/Q/R/S/T 신규 (`add_categories_and_bots.py:86-117`).
- `cascading.py:54` — `collection_name` 파라미터 이미 수용. 라인 91에서 `hybrid_search()`로 전달.
- `hybrid.py:52` — `source_filter: list[str] | None`, MatchAny로 source 배열 매칭 (라인 80-85).
- `chatbot/router.py:35-60` — `GET /admin/chatbot-configs`, `PATCH /admin/chatbot-configs/{id}` (search_tiers JSONB 수정 가능).
- `admin/src/features/chatbot/components/chatbot-form.tsx:31-37` — SearchTierEditor + WeightedSourceEditor 기존 구현. **collection_main select 추가 위치**.
- Alembic: `backend/alembic/versions/`, 최신 rev `dcf99a84bff1`.

### RAGAS 평가 (`backend/scripts/`)

- `eval_ragas.py:161-176` — 4메트릭 (Faithfulness, ContextPrecision, ContextRecall, ResponseRelevancy). 평가 LLM `gemini-2.5-pro` (라인 61), 임베딩 `gemini-embedding-001` (라인 62).
- 시드 schema: `{id, source_file, level, category, question, answer, ground_truth, contexts: list[str]}`. `~/Downloads/ragas_eval_seed_50_20260427_2306.json` 50건 + 평균 3 contexts.
- 출력 13컬럼 xlsx + summary 시트.
- contexts 추출 패턴 (`sample_eval_pairs.py:104-116`): xlsx 참고1/2/3 셀에서 정규식. 형식 `[문서명] (score=X, source=Y)\n<본문>`.

---

## File Structure

| 종류 | 경로 | 책임 |
|---|---|---|
| 생성 | `docs/dev-log/2026-04-28-option-b-and-g.md` | dev-log (분기 #2 진입 + 종료) |
| **G 그룹** | | |
| 생성 | `~/Downloads/ragas_eval_seed_50_with_source_label.json` | 시드 50건에 `gold_source: str` 추가 |
| 생성 | `backend/scripts/eval_per_source.py` | 5 source × 4메트릭 매트릭스 평가 |
| 생성 | `backend/tests/scripts/test_eval_per_source.py` | G 단위 테스트 |
| 생성 | `~/Downloads/per_source_ablation_<date>.xlsx` | 산출물 |
| 생성 | `docs/dev-log/2026-04-28-source-ablation.md` | G 결과 + 약점 source 식별 |
| **B 인프라 그룹** | | |
| 수정 | `backend/src/pipeline/chunker.py:16-24` | `Chunk.prefix_text: str = ""` 추가 |
| 수정 | `backend/src/pipeline/ingestor.py:154` | `_build_text_for_embedding(c)` helper로 prefix prepend |
| 생성 | `backend/tests/pipeline/test_ingestor_prefix.py` | prefix prepend 단위 테스트 |
| 수정 | `backend/src/chatbot/models.py:15-30` | `ChatbotConfig.collection_main: str = Field(default="malssum_poc")` |
| 생성 | `backend/alembic/versions/<new>_add_collection_main.py` | 마이그레이션 |
| 수정 | `backend/src/chatbot/repository.py` | (변경 없음 - JSON column 자동) |
| 수정 | `backend/src/chat/service.py` | retrieval 호출 시 `chatbot_config.collection_main` 전달 |
| 생성 | `backend/tests/chat/test_collection_main_routing.py` | 'all' 봇 collection_main 라우팅 테스트 |
| 수정 | `admin/src/features/chatbot/types.ts` | 타입 동기화 |
| 수정 | `admin/src/features/chatbot/components/chatbot-form.tsx` | collection_main select 추가 |
| **B Prefix 생성 그룹** | | |
| 생성 | `backend/scripts/build_contextual_prefix.py` | 청크별 50~100토큰 prefix 생성 (Gemini Flash batch) |
| 생성 | `backend/tests/scripts/test_build_contextual_prefix.py` | 단위 테스트 |
| 생성 | `~/Downloads/contextual_prefix_<volume>.jsonl` | 권별 prefix JSONL (~615 파일) |
| **B 재인덱싱 그룹** | | |
| 생성 | `backend/scripts/reindex_with_prefix.py` | malssum_poc_v2 인덱싱 (Chunk.prefix_text 사용) |
| 생성 | `backend/tests/scripts/test_reindex_with_prefix.py` | 단위 테스트 |
| **A/B 평가 그룹** | | |
| 생성 | `~/Downloads/contextual_retrieval_ab_<date>.xlsx` | RAGAS 50건 v1 vs v2 |
| 생성 | `~/Downloads/notebooklm_v2_<date>_*.xlsx` | NotebookLM 200건 v2 (옵션 D 스크립트 재사용) |
| 생성 | `~/Downloads/notebooklm_v2_<date>_category_analysis_*.xlsx` | 옵션 D 카테고리 분석 v2 |
| 생성 | `docs/dev-log/2026-04-28-contextual-retrieval-ab.md` | A/B 보고서 + 종료 기준 검증 |

---

## Tasks

### Group A — 옵션 G PoC (0.5~1일)

#### Task 1: 시드 50건에 ground-truth source 라벨링

**Files:**
- Create: `~/Downloads/ragas_eval_seed_50_with_source_label.json`
- Create: `backend/scripts/label_seed_with_source.py`

- [ ] **Step 1: 라벨링 스크립트 작성** — 시드의 contexts 텍스트에서 `[문서명.txt] (... source=X)` 패턴을 정규식으로 추출, 가장 많이 등장하는 source 1개를 `gold_source`로 부여. multi-source 행은 첫 번째 + `gold_source_secondary`로 분리.

```python
# backend/scripts/label_seed_with_source.py
"""RAGAS 시드 50건의 contexts에서 source 코드를 정규식으로 추출해 gold_source 추가."""
from __future__ import annotations
import argparse, json, re
from collections import Counter
from pathlib import Path

SOURCE_RE = re.compile(r"source=([A-T])")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()
    seed = json.loads(args.input.read_text(encoding="utf-8"))
    out: list[dict] = []
    for row in seed:
        ctxs = row.get("contexts") or []
        codes = [m for c in ctxs for m in SOURCE_RE.findall(str(c))]
        counts = Counter(codes)
        gold = counts.most_common(1)[0][0] if counts else "Unknown"
        secondary = counts.most_common(2)[1][0] if len(counts) > 1 else None
        out.append({**row, "gold_source": gold, "gold_source_secondary": secondary})
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"라벨링 완료: {args.output} | {len(out)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 스크립트 실행**

```bash
PYTHONPATH=. uv run python scripts/label_seed_with_source.py \
  --input "$HOME/Downloads/ragas_eval_seed_50_20260427_2306.json" \
  --output "$HOME/Downloads/ragas_eval_seed_50_with_source_label.json"
```

Expected: `라벨링 완료: ... | 50건`.

- [ ] **Step 3: gold_source 분포 확인**

```bash
uv run python -c "
import json
data = json.load(open('$HOME/Downloads/ragas_eval_seed_50_with_source_label.json'))
from collections import Counter
print(Counter(r['gold_source'] for r in data))
"
```

Expected: 5 source(B/L/M/N/O) 분포 출력 — 균등하지 않으면 G 결과 해석 시 small-n 주의.

- [ ] **Step 4: commit**

```bash
git add backend/scripts/label_seed_with_source.py
git commit -m "feat(eval/g): label RAGAS seed with gold_source from contexts"
```

---

#### Task 2: TDD per-source 평가 — 실패 테스트

**Files:**
- Create: `backend/tests/scripts/test_eval_per_source.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/scripts/test_eval_per_source.py
"""eval_per_source 단위 테스트.

목적: 시드 50건에서 source별로 4메트릭 평균을 분해하는 함수 검증.
"""
from __future__ import annotations
from pathlib import Path
import json
import pytest

from scripts.eval_per_source import (
    group_seed_by_source,
    compute_source_metric_matrix,
)


def _write_seed(path: Path, rows: list[dict]) -> None:
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def test_group_seed_by_source_buckets_correctly(tmp_path: Path) -> None:
    seed = tmp_path / "seed.json"
    _write_seed(seed, [
        {"id": 1, "gold_source": "B", "question": "q1", "ground_truth": "g1", "contexts": ["c1"]},
        {"id": 2, "gold_source": "L", "question": "q2", "ground_truth": "g2", "contexts": ["c2"]},
        {"id": 3, "gold_source": "B", "question": "q3", "ground_truth": "g3", "contexts": ["c3"]},
    ])
    grouped = group_seed_by_source(seed)
    assert set(grouped.keys()) == {"B", "L"}
    assert len(grouped["B"]) == 2
    assert len(grouped["L"]) == 1


def test_compute_source_metric_matrix_returns_per_source_averages() -> None:
    per_source_results = {
        "B": [
            {"faithfulness": 0.6, "context_precision": 0.7, "context_recall": 0.5, "answer_relevancy": 0.8},
            {"faithfulness": 0.4, "context_precision": 0.5, "context_recall": 0.3, "answer_relevancy": 0.6},
        ],
        "L": [
            {"faithfulness": 0.8, "context_precision": 0.9, "context_recall": 0.7, "answer_relevancy": 0.9},
        ],
    }
    matrix = compute_source_metric_matrix(per_source_results)
    rows = {r["source"]: r for r in matrix}
    assert rows["B"]["n"] == 2
    assert rows["B"]["faithfulness"] == pytest.approx(0.5)
    assert rows["L"]["n"] == 1
    assert rows["L"]["faithfulness"] == pytest.approx(0.8)


def test_compute_matrix_handles_empty_source() -> None:
    assert compute_source_metric_matrix({}) == []
```

- [ ] **Step 2: 실패 확인**

```bash
uv run pytest tests/scripts/test_eval_per_source.py -v
```

Expected: 3 errors (ModuleNotFoundError).

---

#### Task 3: `eval_per_source.py` 구현

**Files:**
- Create: `backend/scripts/eval_per_source.py`

- [ ] **Step 1: 최소 구현**

`eval_ragas.py`의 평가 헬퍼를 재사용해 source별로 분할 평가. 직접 import 가능 (testpaths/pythonpath 호환).

```python
"""Source-weight ablation 평가.

시드 50건을 gold_source로 분할 → 각 source별 RAGAS 4메트릭 측정 →
source × metric 매트릭스 xlsx 출력.

사용 예:
    PYTHONPATH=. uv run python scripts/eval_per_source.py \
        --seed ~/Downloads/ragas_eval_seed_50_with_source_label.json \
        --output ~/Downloads/per_source_ablation_20260428.xlsx \
        --api-base http://localhost:8000 \
        --chatbot-id all
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl import Workbook

from scripts.eval_ragas import evaluate_seed  # 기존 RAGAS 평가 함수 재사용


METRICS = ("faithfulness", "context_precision", "context_recall", "answer_relevancy")


def group_seed_by_source(seed_path: Path) -> dict[str, list[dict]]:
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        grouped[str(r.get("gold_source", "Unknown"))].append(r)
    return dict(grouped)


def compute_source_metric_matrix(
    per_source_results: dict[str, list[dict]],
) -> list[dict]:
    if not per_source_results:
        return []
    out: list[dict] = []
    for src in sorted(per_source_results):
        rows = per_source_results[src]
        n = len(rows)
        avg = {m: sum(r.get(m, 0.0) for r in rows) / n if n else 0.0 for m in METRICS}
        out.append({"source": src, "n": n, **avg})
    return out


def _write_excel(matrix: list[dict], output: Path) -> None:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "per_source"
    ws.append(["source", "n", *METRICS])
    for r in matrix:
        ws.append([r["source"], r["n"], *(round(r[m], 4) for m in METRICS)])
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--api-base", default="http://localhost:8000")
    p.add_argument("--chatbot-id", default="all")
    args = p.parse_args()

    grouped = group_seed_by_source(args.seed)
    per_source_results: dict[str, list[dict]] = {}
    for src, rows in grouped.items():
        print(f"=== source={src} | n={len(rows)} ===")
        # evaluate_seed: 기존 시그니처 (seed_rows, api_base, chatbot_id) → 행별 메트릭 dict 리스트
        per_source_results[src] = evaluate_seed(rows, args.api_base, args.chatbot_id)

    matrix = compute_source_metric_matrix(per_source_results)
    _write_excel(matrix, args.output)
    print(f"\n완료: {args.output}")
    print(f"{'source':<10} {'n':>3} {'fa':>8} {'cp':>8} {'cr':>8} {'ar':>8}")
    for r in matrix:
        print(f"{r['source']:<10} {r['n']:>3} {r['faithfulness']:>8.3f} {r['context_precision']:>8.3f} {r['context_recall']:>8.3f} {r['answer_relevancy']:>8.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

> **NOTE for engineer:** 만약 `eval_ragas.py`에 `evaluate_seed(seed_rows, api_base, chatbot_id) -> list[dict]` 형식의 공개 함수가 없으면, 먼저 `eval_ragas.py`의 메인 평가 루프를 함수로 추출 (Refactor only, behavior 동일). 추출 후 본 task로 복귀.

- [ ] **Step 2: 테스트 통과 확인**

```bash
uv run pytest tests/scripts/test_eval_per_source.py -v
```

Expected: 3 passed.

- [ ] **Step 3: commit**

```bash
git add backend/scripts/eval_per_source.py backend/tests/scripts/test_eval_per_source.py
git commit -m "feat(eval/g): per-source RAGAS 4-metric ablation"
```

---

#### Task 4: G 측정 + 약점 source 식별 보고서

**Files:**
- Create: `~/Downloads/per_source_ablation_<date>.xlsx`
- Create: `docs/dev-log/2026-04-28-source-ablation.md`

- [ ] **Step 1: semantic_cache 비우기**

```bash
curl -sS -X POST 'http://localhost:6333/collections/semantic_cache/points/delete' \
  -H 'content-type: application/json' -d '{"filter":{}}'
```

- [ ] **Step 2: G 측정**

```bash
DATE=$(date +%Y%m%d_%H%M)
PYTHONPATH=. uv run python scripts/eval_per_source.py \
  --seed "$HOME/Downloads/ragas_eval_seed_50_with_source_label.json" \
  --output "$HOME/Downloads/per_source_ablation_${DATE}.xlsx" \
  --api-base http://localhost:8000 \
  --chatbot-id all
```

Expected: source별 매트릭스 5×4 출력 + xlsx 저장. Anthropic 크레딧 부족이면 평가 LLM은 gemini-2.5-pro 그대로.

- [ ] **Step 3: 약점 source 식별** — 매트릭스에서 `faithfulness < 0.50` 또는 `context_recall < 0.40`인 source를 우선순위 #1로 표시. 다음 #2, #3.

- [ ] **Step 4: 보고서 작성** (`docs/dev-log/2026-04-28-source-ablation.md`)

내용 골격:
- 산출물 절대경로
- 매트릭스 5×4 표 인용
- 약점 source 1~3개 식별 (`faithfulness < 0.50` 또는 `context_recall < 0.40` 기준)
- 인계서 §4-G 권장: 약점 source의 청크에 contextual prefix 우선 적용 → Group C Task 12에서 우선순위 입력
- weight 또는 score_threshold 미세 조정 권고안 (operator-facing)

- [ ] **Step 5: commit**

```bash
git add docs/dev-log/2026-04-28-source-ablation.md
git commit -m "docs(eval/g): per-source ablation report — weakest source identification"
```

---

### Group B — 옵션 B 인프라 (1일)

#### Task 5: `Chunk.prefix_text` 필드 추가 + ingestor prefix prepend

**Files:**
- Modify: `backend/src/pipeline/chunker.py:16-24`
- Modify: `backend/src/pipeline/ingestor.py:154` (배치 텍스트 빌드 부분)
- Create: `backend/tests/pipeline/test_ingestor_prefix.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/pipeline/test_ingestor_prefix.py
"""Chunk.prefix_text가 있을 때 임베딩 입력 텍스트가 prefix + 청크 원문으로 구성되는지 검증."""
from __future__ import annotations
from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import _build_text_for_embedding


def test_build_text_for_embedding_prepends_prefix_when_present() -> None:
    c = Chunk(
        text="아담과 해와는 인류의 참조상이 될 사람이었습니다.",
        volume="말씀선집 007권",
        chunk_index=1,
        source=["O"],
        title="참조상의 의미",
        date="1956년 10월 3일",
        prefix_text="이 청크는 '말씀선집 007권' 1956년 10월 강의 중 '참조상' 개념을 다룬다.",
    )
    out = _build_text_for_embedding(c)
    assert out.startswith("이 청크는")
    assert "아담과 해와는 인류의 참조상" in out
    assert out.count("\n\n") >= 1


def test_build_text_for_embedding_falls_back_to_text_when_no_prefix() -> None:
    c = Chunk(text="원문만", volume="v", chunk_index=0)
    assert _build_text_for_embedding(c) == "원문만"
```

- [ ] **Step 2: 실패 확인**

```bash
uv run pytest tests/pipeline/test_ingestor_prefix.py -v
```

Expected: ImportError (`Chunk.prefix_text`도 `_build_text_for_embedding`도 없음).

- [ ] **Step 3: `Chunk` 데이터클래스 수정**

`backend/src/pipeline/chunker.py:16-24`:

```python
@dataclass
class Chunk:
    text: str
    volume: str
    chunk_index: int
    source: list[str] | str = ""
    title: str = ""
    date: str = ""
    prefix_text: str = ""  # Anthropic Contextual Retrieval prefix (옵션 B)
```

- [ ] **Step 4: ingestor에 helper 추가**

`backend/src/pipeline/ingestor.py` (라인 154 위에 helper 추가):

```python
def _build_text_for_embedding(chunk: Chunk) -> str:
    """Contextual Retrieval prefix가 있으면 prepend, 없으면 원문만."""
    if chunk.prefix_text:
        return f"{chunk.prefix_text}\n\n{chunk.text}"
    return chunk.text
```

라인 154 변경:

```python
batch_texts = [_build_text_for_embedding(c) for c in batch_chunks]
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
uv run pytest tests/pipeline/test_ingestor_prefix.py -v && uv run pytest -q -k "ingestor or chunker"
```

Expected: 2 passed (신규) + 기존 ingestor/chunker 테스트 모두 통과.

- [ ] **Step 6: commit**

```bash
git add backend/src/pipeline/chunker.py backend/src/pipeline/ingestor.py backend/tests/pipeline/test_ingestor_prefix.py
git commit -m "feat(pipeline): Chunk.prefix_text + ingestor prefix prepend hook"
```

---

#### Task 6: `ChatbotConfig.collection_main` 필드 추가 + Alembic 마이그레이션

**Files:**
- Modify: `backend/src/chatbot/models.py:15-30`
- Create: `backend/alembic/versions/<new>_add_collection_main_to_chatbot_configs.py`
- Create: `backend/tests/chatbot/test_collection_main_field.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/chatbot/test_collection_main_field.py
"""ChatbotConfig.collection_main 필드 검증 — 기본값 'malssum_poc' + 수정 가능."""
from __future__ import annotations
from src.chatbot.models import ChatbotConfig


def test_collection_main_defaults_to_malssum_poc() -> None:
    cfg = ChatbotConfig(chatbot_id="t", display_name="t", search_tiers={})
    assert cfg.collection_main == "malssum_poc"


def test_collection_main_can_be_set_to_v2() -> None:
    cfg = ChatbotConfig(
        chatbot_id="t", display_name="t",
        search_tiers={}, collection_main="malssum_poc_v2",
    )
    assert cfg.collection_main == "malssum_poc_v2"
```

- [ ] **Step 2: 실패 확인**

```bash
uv run pytest tests/chatbot/test_collection_main_field.py -v
```

Expected: 2 errors (필드 없음).

- [ ] **Step 3: 모델 수정** — `backend/src/chatbot/models.py`의 `ChatbotConfig` 클래스 (라인 15~30) 본문에 다음 필드 추가:

```python
    collection_main: str = Field(default="malssum_poc", description="Qdrant 컬렉션 이름 (기본값) — A/B 토글용")
```

- [ ] **Step 4: Alembic 마이그레이션 생성**

```bash
cd backend
uv run alembic revision --autogenerate -m "add collection_main to chatbot_configs"
```

Expected: `backend/alembic/versions/<random_id>_add_collection_main_to_chatbot_configs.py` 생성. 파일을 열어 `op.add_column('chatbot_configs', sa.Column('collection_main', sa.String(), nullable=False, server_default='malssum_poc'))` 와 downgrade의 `op.drop_column(...)` 인지 확인. 다른 변경(예: 다른 모델 자동검출)이 섞이면 그것만 제거.

- [ ] **Step 5: 마이그레이션 적용**

```bash
uv run alembic upgrade head
```

Expected: `INFO  [alembic.runtime.migration] Running upgrade ... -> <new_id>, add collection_main to chatbot_configs`.

- [ ] **Step 6: 테스트 통과 + DB 확인**

```bash
uv run pytest tests/chatbot/test_collection_main_field.py -v && \
docker exec backend-postgres-1 psql -U truewords -d truewords -c "\d chatbot_configs" | grep collection_main
```

Expected: 2 passed + ` collection_main | character varying | not null default 'malssum_poc'::character varying` 표시.

- [ ] **Step 7: commit**

```bash
git add backend/src/chatbot/models.py backend/alembic/versions/*_add_collection_main_to_chatbot_configs.py backend/tests/chatbot/test_collection_main_field.py
git commit -m "feat(chatbot): add collection_main field for A/B collection toggle"
```

---

#### Task 7: chat service에 collection_main 라우팅

**Files:**
- Modify: `backend/src/chat/service.py` (retrieval 호출 지점)
- Create: `backend/tests/chat/test_collection_main_routing.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/chat/test_collection_main_routing.py
"""ChatService가 ChatbotConfig.collection_main을 retrieval 단계로 전달하는지 검증."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock
import pytest


@pytest.mark.asyncio
async def test_retrieval_uses_chatbot_collection_main(monkeypatch) -> None:
    from src.chat.service import ChatService
    from src.chatbot.models import ChatbotConfig

    cfg = ChatbotConfig(
        chatbot_id="all", display_name="all", search_tiers={"weighted_sources": []},
        collection_main="malssum_poc_v2",
    )
    captured = {}

    async def fake_search(*, collection_name, **kwargs):
        captured["collection"] = collection_name
        return []

    # ChatService 내부 retrieval 호출 함수를 monkeypatch — 정확한 함수명은
    # 구현 단계에서 src/chat/service.py의 retrieval 호출부를 보고 결정.
    monkeypatch.setattr("src.chat.service._search_with_collection", fake_search)
    service = ChatService(...)  # 실제 구현 시 dependencies로 채움
    await service._retrieve(cfg, query="t")
    assert captured["collection"] == "malssum_poc_v2"
```

> **NOTE for engineer:** ChatService 생성자/메서드의 정확한 모양은 `backend/src/chat/service.py`를 직접 읽고 결정. 본 plan은 설계만 명시 — 시그니처가 다르면 실제 코드에 맞게 mock을 수정하되 "collection_name이 chatbot_config.collection_main으로부터 흘러간다"는 invariant만 검증하면 됨.

- [ ] **Step 2: 실패 확인 + 실제 호출 흐름 파악**

```bash
uv run pytest tests/chat/test_collection_main_routing.py -v
grep -n "collection_name\|cascading_search\|hybrid_search" backend/src/chat/service.py | head -20
```

위 grep으로 실제 retrieval 호출 지점 식별.

- [ ] **Step 3: service에 collection_main 주입** — retrieval 호출 시 `collection_name=chatbot_config.collection_main` 전달. 기존 코드가 `settings.collection_name`을 직접 쓰면 그 자리를 인자로 교체.

- [ ] **Step 4: 테스트 통과 확인**

```bash
uv run pytest tests/chat/test_collection_main_routing.py -v && uv run pytest -q -k "chat_service"
```

Expected: 1 passed + 기존 chat_service 테스트 통과 (단, 본 plan과 무관한 main 5건 회귀는 무시 — `Context` 절 참조).

- [ ] **Step 5: commit**

```bash
git add backend/src/chat/service.py backend/tests/chat/test_collection_main_routing.py
git commit -m "feat(chat): route retrieval to chatbot_config.collection_main"
```

---

#### Task 8: admin frontend collection_main select 추가

**Files:**
- Modify: `admin/src/features/chatbot/types.ts`
- Modify: `admin/src/features/chatbot/components/chatbot-form.tsx`

- [ ] **Step 1: 타입 동기화** — `admin/src/features/chatbot/types.ts`의 `ChatbotConfig` 인터페이스에 `collection_main: string` 추가:

```typescript
export interface ChatbotConfig {
  chatbot_id: string;
  display_name: string;
  search_tiers: SearchTiers;
  collection_main: string; // "malssum_poc" | "malssum_poc_v2"
  // ... 기존 필드들
}
```

- [ ] **Step 2: 폼에 select 추가** — `chatbot-form.tsx`의 SearchTierEditor 위(또는 아래)에 select 박스 추가:

```tsx
<FormField
  control={form.control}
  name="collection_main"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Qdrant 컬렉션</FormLabel>
      <Select onValueChange={field.onChange} value={field.value}>
        <FormControl>
          <SelectTrigger><SelectValue placeholder="컬렉션 선택" /></SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="malssum_poc">malssum_poc (기본)</SelectItem>
          <SelectItem value="malssum_poc_v2">malssum_poc_v2 (Contextual Retrieval)</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

- [ ] **Step 3: admin dev 서버에서 시각 검증**

```bash
cd admin && npm run dev
# 브라우저에서 /chatbots/all 편집 화면 → 컬렉션 select 표시 확인
```

- [ ] **Step 4: commit**

```bash
git add admin/src/features/chatbot/types.ts admin/src/features/chatbot/components/chatbot-form.tsx
git commit -m "feat(admin/chatbot): collection_main select for A/B Qdrant toggle"
```

---

### Group C — Contextual Prefix 생성 (3~5일)

#### Task 9: TDD `build_contextual_prefix.py` 실패 테스트

**Files:**
- Create: `backend/tests/scripts/test_build_contextual_prefix.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/scripts/test_build_contextual_prefix.py
"""build_contextual_prefix 단위 테스트."""
from __future__ import annotations
from pathlib import Path
import json
import pytest

from scripts.build_contextual_prefix import (
    build_prompt,
    parse_prefix_response,
    iter_chunks_from_volume_jsonl,
)


def test_build_prompt_inserts_full_doc_and_chunk() -> None:
    prompt = build_prompt(
        full_doc="A B C 1956년 10월 3일 강의록", chunk_text="C", chunk_index=2
    )
    assert "<document>" in prompt and "A B C 1956년 10월 3일 강의록" in prompt
    assert "<chunk>C</chunk>" in prompt
    assert "한국어" in prompt and ("시기" in prompt or "장소" in prompt or "주제" in prompt)


def test_parse_prefix_response_strips_markup() -> None:
    raw = "  이 청크는 1956년 10월 3일 '말씀선집 007권' 강의 중 참조상 개념을 다룬다.  "
    out = parse_prefix_response(raw)
    assert out.startswith("이 청크는")
    assert not out.endswith(" ")
    assert len(out) <= 400  # 50~100토큰 휴리스틱


def test_iter_chunks_from_volume_jsonl_yields_dicts(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text(
        json.dumps({"chunk_index": 0, "text": "t1"}) + "\n" +
        json.dumps({"chunk_index": 1, "text": "t2"}) + "\n",
        encoding="utf-8",
    )
    items = list(iter_chunks_from_volume_jsonl(p))
    assert [i["chunk_index"] for i in items] == [0, 1]
    assert items[0]["text"] == "t1"
```

- [ ] **Step 2: 실패 확인**

```bash
uv run pytest tests/scripts/test_build_contextual_prefix.py -v
```

Expected: 3 errors (모듈 미존재).

---

#### Task 10: `build_contextual_prefix.py` 구현

**Files:**
- Create: `backend/scripts/build_contextual_prefix.py`

- [ ] **Step 1: 최소 구현**

```python
"""Anthropic Contextual Retrieval prefix 생성기.

615권 18만 청크에 50~100토큰 한국어 contextual prefix 부여.
입력: 권별 JSONL (각 줄 = 청크 dict {chunk_index, text, volume, ...})
출력: 권별 JSONL에 `prefix_text` 필드 추가
LLM: Gemini 2.5 Flash batch (또는 단발 호출 — config로 토글)

사용 예 (단발 호출, 1권 dry-run):
    PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
        --input ~/data/chunks/말씀선집_007권.jsonl \
        --output ~/Downloads/contextual_prefix_007권.jsonl \
        --mode oneshot --limit 50

사용 예 (전체 615권 batch):
    PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
        --input-dir ~/data/chunks \
        --output-dir ~/Downloads/contextual_prefixes \
        --mode batch
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Iterator
from pathlib import Path

from src.common.gemini import generate_text


PROMPT_TEMPLATE = """<document>{full_doc}</document>

다음 청크를 위 전체 문서 맥락 안에 위치시키시오:
<chunk>{chunk_text}</chunk>

검색 정확도 향상을 위해 이 청크가 전체 문서의 어느 부분에 해당하는지
간결한 한국어 한두 문장으로만 답하시오. (시기/장소/주제 포함, 50~100자)
설명·머리말·꼬리말 없이 한 문장 본문만 출력."""


def build_prompt(full_doc: str, chunk_text: str, chunk_index: int) -> str:
    # chunk_index는 디버그/추적용 — 프롬프트엔 포함 안 함 (Anthropic 원형 유지)
    return PROMPT_TEMPLATE.format(full_doc=full_doc[:8000], chunk_text=chunk_text[:1500])


def parse_prefix_response(raw: str) -> str:
    text = (raw or "").strip()
    # 너무 길면 첫 두 문장만
    if len(text) > 400:
        sents = text.split("。") if "。" in text else text.split(".")
        text = ". ".join(sents[:2]).strip()
    return text


def iter_chunks_from_volume_jsonl(path: Path) -> Iterator[dict]:
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


async def generate_prefix_for_volume(volume_path: Path, output: Path, limit: int | None = None) -> None:
    chunks = list(iter_chunks_from_volume_jsonl(volume_path))
    if limit:
        chunks = chunks[:limit]
    full_doc = "\n".join(c.get("text", "") for c in chunks)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as out_f:
        for c in chunks:
            prompt = build_prompt(full_doc, c["text"], c.get("chunk_index", 0))
            raw = await generate_text(prompt, model="gemini-2.5-flash")
            c["prefix_text"] = parse_prefix_response(raw)
            out_f.write(json.dumps(c, ensure_ascii=False) + "\n")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, help="단일 권 JSONL")
    p.add_argument("--output", type=Path)
    p.add_argument("--input-dir", type=Path, help="전체 권 JSONL 디렉토리")
    p.add_argument("--output-dir", type=Path)
    p.add_argument("--mode", choices=["oneshot", "batch"], default="oneshot")
    p.add_argument("--limit", type=int)
    args = p.parse_args()

    if args.mode == "oneshot":
        if not args.input or not args.output:
            raise SystemExit("--input + --output 필요")
        asyncio.run(generate_prefix_for_volume(args.input, args.output, args.limit))
        print(f"완료: {args.output}")
    else:
        if not args.input_dir or not args.output_dir:
            raise SystemExit("--input-dir + --output-dir 필요")
        for vol in sorted(args.input_dir.glob("*.jsonl")):
            out = args.output_dir / vol.name
            if out.exists():
                continue  # resumable
            asyncio.run(generate_prefix_for_volume(vol, out, args.limit))
            print(f"완료: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

> **Note**: Gemini Batch API로 18만 청크를 다 넣고 결과만 받는 패턴이 더 효율적이면 `batch_service.py` 흐름 재사용 (BatchJob 생성 → 폴링 → 결과 파싱). 본 task에서는 1권 dry-run을 oneshot로 검증한 후, batch 변환은 Task 11에서 결정 (품질이 충분히 좋으면 oneshot도 30시간 안에 완료 가능).

- [ ] **Step 2: 테스트 통과 확인**

```bash
uv run pytest tests/scripts/test_build_contextual_prefix.py -v
```

Expected: 3 passed.

- [ ] **Step 3: commit**

```bash
git add backend/scripts/build_contextual_prefix.py backend/tests/scripts/test_build_contextual_prefix.py
git commit -m "feat(eval/b): build_contextual_prefix.py — Anthropic Contextual Retrieval prefix gen"
```

---

#### Task 11: 1권 dry-run + 품질 점검

**Files:**
- Create: `~/Downloads/contextual_prefix_dryrun_평화경.jsonl`
- Create: `docs/dev-log/2026-04-28-prefix-dryrun.md`

- [ ] **Step 1: 청크 JSONL 추출** — Qdrant `malssum_poc`에서 1권(예: `평화경.txt`) 청크를 모두 dump해 JSONL 생성:

```bash
PYTHONPATH=. uv run python -c "
import asyncio, json
from src.qdrant_client import get_async_client
from qdrant_client.models import Filter, FieldCondition, MatchValue
async def main():
    c = get_async_client()
    pts, _ = await c.scroll(
        collection_name='malssum_poc',
        scroll_filter=Filter(must=[FieldCondition(key='volume', match=MatchValue(value='평화경'))]),
        limit=10000, with_payload=True, with_vectors=False,
    )
    with open('/tmp/평화경_chunks.jsonl', 'w', encoding='utf-8') as f:
        for p in pts:
            f.write(json.dumps({**p.payload, 'point_id': str(p.id)}, ensure_ascii=False) + '\n')
    print(f'{len(pts)} chunks')
asyncio.run(main())
"
```

Expected: `<n> chunks` (평화경은 ~150 청크 추정).

- [ ] **Step 2: dry-run prefix 생성**

```bash
PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
  --input /tmp/평화경_chunks.jsonl \
  --output "$HOME/Downloads/contextual_prefix_dryrun_평화경.jsonl" \
  --mode oneshot --limit 50
```

Expected: 50 청크에 prefix_text 부여, 5~10분 소요.

- [ ] **Step 3: 품질 sample 점검**

```bash
uv run python -c "
import json
for i, line in enumerate(open('$HOME/Downloads/contextual_prefix_dryrun_평화경.jsonl')):
    if i % 10 == 0:
        d = json.loads(line)
        print(f'\n#{d[\"chunk_index\"]}\nORIG: {d[\"text\"][:150]}\nPREFIX: {d[\"prefix_text\"]}')
"
```

품질 기준:
- prefix가 시기·장소·주제 중 1개 이상 포함
- 50~150자 길이
- 청크 원문을 단순 반복하지 않음

기준 미달이 30% 이상이면 `PROMPT_TEMPLATE` 수정 후 재시도 (max 2회 — Generator-Evaluator 3회 상한).

- [ ] **Step 4: 보고서 작성** (`docs/dev-log/2026-04-28-prefix-dryrun.md`) — sample 5개 인용 + 품질 평가 + 본 생성(Task 12) GO/NO-GO 결정.

- [ ] **Step 5: commit**

```bash
git add docs/dev-log/2026-04-28-prefix-dryrun.md
git commit -m "docs(eval/b): contextual prefix dry-run on 평화경 50 chunks"
```

---

#### Task 12: 18만 청크 prefix 본 생성 (G 결과 우선순위 적용)

**Files:**
- Create: `~/Downloads/contextual_prefixes/<volume>.jsonl` × ~615

- [ ] **Step 1: 권별 청크 JSONL 일괄 추출** — Qdrant scroll로 모든 volume을 별도 JSONL로 dump.

```bash
PYTHONPATH=. uv run python -c "
import asyncio, json, os
from pathlib import Path
from src.qdrant_client import get_async_client
async def main():
    c = get_async_client()
    out_dir = Path('/tmp/all_chunks_jsonl'); out_dir.mkdir(exist_ok=True)
    # 1) 모든 volume 목록 수집
    volumes = set()
    next_offset = None
    while True:
        pts, next_offset = await c.scroll(collection_name='malssum_poc', limit=2000,
            with_payload=True, with_vectors=False, offset=next_offset)
        for p in pts:
            v = p.payload.get('volume')
            if v: volumes.add(v)
        if not next_offset: break
    print(f'{len(volumes)} volumes')
    # 2) 권별 dump
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    for v in sorted(volumes):
        pts, _ = await c.scroll(collection_name='malssum_poc',
            scroll_filter=Filter(must=[FieldCondition(key='volume', match=MatchValue(value=v))]),
            limit=10000, with_payload=True, with_vectors=False)
        safe = v.replace('/', '_')
        with open(out_dir / f'{safe}.jsonl', 'w', encoding='utf-8') as f:
            for p in pts:
                f.write(json.dumps({**p.payload, 'point_id': str(p.id)}, ensure_ascii=False) + '\n')
    print('done')
asyncio.run(main())
"
```

- [ ] **Step 2: G의 약점 source부터 우선** — G 보고서(`docs/dev-log/2026-04-28-source-ablation.md`)의 우선순위 #1 source를 갖는 권을 먼저 처리:

```bash
WEAK_SOURCE=N  # G 보고서에서 식별된 약점 source로 교체
PYTHONPATH=. uv run python -c "
import json, os
from pathlib import Path
src_dir = Path('/tmp/all_chunks_jsonl')
weak = []
for f in src_dir.glob('*.jsonl'):
    first = next(open(f), None)
    if first and '\"$WEAK_SOURCE\"' in first:
        weak.append(f)
print(len(weak), 'volumes for source=$WEAK_SOURCE')
# 약점 source 권을 우선 처리하기 위해 별도 디렉토리로 이동
prio = src_dir.parent / 'priority_chunks_jsonl'
prio.mkdir(exist_ok=True)
for f in weak: f.rename(prio / f.name)
"

# 약점 source 우선 batch
PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
  --input-dir /tmp/priority_chunks_jsonl \
  --output-dir "$HOME/Downloads/contextual_prefixes" \
  --mode batch
```

Expected: 권별 prefix JSONL 생성 (`contextual_prefixes/<volume>.jsonl`).

- [ ] **Step 3: 나머지 source 권 처리**

```bash
PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
  --input-dir /tmp/all_chunks_jsonl \
  --output-dir "$HOME/Downloads/contextual_prefixes" \
  --mode batch
```

장기 작업 (~30시간). `--input-dir` mode는 이미 처리한 권을 skip(Task 10 코드 참조), 중간에 끊겨도 resumable.

- [ ] **Step 4: 산출물 검증**

```bash
ls "$HOME/Downloads/contextual_prefixes/" | wc -l   # ≈ 615
uv run python -c "
import json, glob
total = empty = 0
for f in glob.glob(os.path.expanduser('$HOME/Downloads/contextual_prefixes/*.jsonl')):
    for line in open(f):
        total += 1
        if not json.loads(line).get('prefix_text','').strip(): empty += 1
print(f'total={total} empty_prefix={empty}')
"
```

Expected: total ≈ 18만, empty_prefix < 5% (이상 시 retry).

- [ ] **Step 5: commit (메타데이터만, 산출물은 ~/Downloads/)**

`~/Downloads/`는 untracked. 별도 commit 없이 다음 task로.

---

### Group D — Qdrant 재인덱싱 (1일)

#### Task 13: `malssum_poc_v2` 컬렉션 생성

**Files:**
- Create: `backend/scripts/create_collection_v2.py`

- [ ] **Step 1: 생성 스크립트**

```python
"""malssum_poc_v2 컬렉션 생성 (malssum_poc와 동일 스키마)."""
from __future__ import annotations
import asyncio
from src.qdrant_client import get_async_client
from src.qdrant_client import create_collection  # 기존 헬퍼 재사용


async def main() -> None:
    client = get_async_client()
    collection = "malssum_poc_v2"
    existing = await client.get_collections()
    if collection in [c.name for c in existing.collections]:
        print(f"이미 존재: {collection}")
        return
    create_collection(client, collection)  # qdrant_client.py:30-41
    print(f"생성 완료: {collection}")


if __name__ == "__main__":
    asyncio.run(main())
```

> **NOTE**: 기존 `create_collection`이 sync인지 async인지는 `qdrant_client.py:30-41`을 보고 sync 호출 또는 `await` 결정.

- [ ] **Step 2: 실행**

```bash
PYTHONPATH=. uv run python scripts/create_collection_v2.py
curl -sS http://localhost:6333/collections | uv run python -c "import sys,json; d=json.load(sys.stdin); print([c['name'] for c in d['result']['collections']])"
```

Expected: `['malssum_poc', 'malssum_poc_v2', 'semantic_cache']`.

- [ ] **Step 3: commit**

```bash
git add backend/scripts/create_collection_v2.py
git commit -m "feat(qdrant): create_collection_v2 helper for A/B Contextual Retrieval"
```

---

#### Task 14: `reindex_with_prefix.py` 구현

**Files:**
- Create: `backend/scripts/reindex_with_prefix.py`
- Create: `backend/tests/scripts/test_reindex_with_prefix.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/scripts/test_reindex_with_prefix.py
"""권별 prefix JSONL을 Chunk 객체로 변환해 ingest_chunks에 전달하는 헬퍼 검증."""
from __future__ import annotations
from pathlib import Path
import json
from scripts.reindex_with_prefix import jsonl_to_chunks


def test_jsonl_to_chunks_preserves_prefix_text(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text(
        json.dumps({"text": "원문", "volume": "v1", "chunk_index": 0, "source": ["B"],
                    "title": "t", "date": "1956", "prefix_text": "PREFIX"}) + "\n",
        encoding="utf-8",
    )
    chunks = jsonl_to_chunks(p)
    assert len(chunks) == 1
    assert chunks[0].prefix_text == "PREFIX"
    assert chunks[0].text == "원문"
    assert chunks[0].source == ["B"]


def test_jsonl_to_chunks_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text("", encoding="utf-8")
    assert jsonl_to_chunks(p) == []
```

- [ ] **Step 2: 실패 확인**

```bash
uv run pytest tests/scripts/test_reindex_with_prefix.py -v
```

Expected: 2 errors.

- [ ] **Step 3: 구현**

```python
"""Prefix가 부여된 권별 JSONL을 malssum_poc_v2에 재인덱싱.

사용 예 (1권):
    PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \
        --input ~/Downloads/contextual_prefixes/평화경.jsonl

사용 예 (전체 615권):
    PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \
        --input-dir ~/Downloads/contextual_prefixes
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from src.config import settings
from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import ingest_chunks
from src.qdrant_client import get_async_client


COLLECTION_V2 = "malssum_poc_v2"


def jsonl_to_chunks(path: Path) -> list[Chunk]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    out: list[Chunk] = []
    for line in path.open("r", encoding="utf-8"):
        if not line.strip():
            continue
        d = json.loads(line)
        out.append(Chunk(
            text=d.get("text", ""),
            volume=d.get("volume", ""),
            chunk_index=d.get("chunk_index", 0),
            source=d.get("source", ""),
            title=d.get("title", ""),
            date=d.get("date", ""),
            prefix_text=d.get("prefix_text", ""),
        ))
    return out


async def reindex_volume(path: Path) -> None:
    client = get_async_client()
    chunks = jsonl_to_chunks(path)
    if not chunks:
        print(f"skip empty: {path.name}")
        return
    title = chunks[0].title or chunks[0].volume
    stats = await ingest_chunks(client, COLLECTION_V2, chunks, start_chunk=0, title=title)
    print(f"완료 {path.name}: {stats}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path)
    p.add_argument("--input-dir", type=Path)
    args = p.parse_args()
    if args.input:
        asyncio.run(reindex_volume(args.input))
    elif args.input_dir:
        for f in sorted(args.input_dir.glob("*.jsonl")):
            asyncio.run(reindex_volume(f))
    else:
        raise SystemExit("--input 또는 --input-dir 필요")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

> **NOTE**: `ingest_chunks`가 `async def`인지 `def`인지는 `backend/src/pipeline/ingestor.py:78`을 직접 확인. 본 plan 가정은 async — 다르면 `await` 제거.

- [ ] **Step 4: 테스트 통과 확인**

```bash
uv run pytest tests/scripts/test_reindex_with_prefix.py -v
```

Expected: 2 passed.

- [ ] **Step 5: 1권 sanity 인덱싱**

```bash
PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \
  --input "$HOME/Downloads/contextual_prefixes/평화경.jsonl"
curl -sS 'http://localhost:6333/collections/malssum_poc_v2' | \
  uv run python -c "import sys,json; print('points:', json.load(sys.stdin)['result']['points_count'])"
```

Expected: `points: <N>` (평화경 청크 수).

- [ ] **Step 6: commit**

```bash
git add backend/scripts/reindex_with_prefix.py backend/tests/scripts/test_reindex_with_prefix.py
git commit -m "feat(qdrant): reindex_with_prefix.py for malssum_poc_v2"
```

---

#### Task 15: 615권 전체 재인덱싱

**Files:**
- 변경 없음 (실행만)

- [ ] **Step 1: 본 인덱싱** (장기, free tier ~30시간)

```bash
DATE=$(date +%Y%m%d_%H%M)
PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \
  --input-dir "$HOME/Downloads/contextual_prefixes" 2>&1 | \
  tee "/tmp/reindex_v2_${DATE}.log"
```

resumable: ingest_chunks의 `IngestionJob` 테이블이 volume_key 기반 진행상황을 보존 → 중간 중단 후 재실행해도 이미 완료된 권 skip.

- [ ] **Step 2: 검증**

```bash
curl -sS 'http://localhost:6333/collections/malssum_poc_v2' | \
  uv run python -c "import sys,json; d=json.load(sys.stdin); print('points:', d['result']['points_count'])"
# 기대: malssum_poc과 같은 ~18만
curl -sS 'http://localhost:6333/collections/malssum_poc' | \
  uv run python -c "import sys,json; print('points:', json.load(sys.stdin)['result']['points_count'])"
# 차이 < 1% 인지 확인
```

Expected: v1 vs v2 포인트 수 차이 < 1%.

---

### Group E — A/B 평가 (0.5일)

#### Task 16: 'all' 봇을 v2로 토글 + RAGAS 50건 A/B

**Files:**
- 변경 없음 (DB 직접 수정 또는 admin UI 사용)
- Create: `~/Downloads/ragas_v1_<date>.xlsx`, `ragas_v2_<date>.xlsx`, `ragas_v1_vs_v2_<date>.xlsx`

- [ ] **Step 1: semantic_cache 비우기**

```bash
curl -sS -X POST 'http://localhost:6333/collections/semantic_cache/points/delete' \
  -H 'content-type: application/json' -d '{"filter":{}}'
```

- [ ] **Step 2: v1 baseline 측정 ('all' 봇 collection_main='malssum_poc')**

```bash
docker exec backend-postgres-1 psql -U truewords -d truewords \
  -c "UPDATE chatbot_configs SET collection_main='malssum_poc' WHERE chatbot_id='all';"
# (백엔드 캐시 무효화: 재시작이 필요하면) docker restart backend-uvicorn-1

DATE=$(date +%Y%m%d_%H%M)
PYTHONPATH=. uv run python scripts/eval_ragas.py \
  --seed "$HOME/Downloads/ragas_eval_seed_50_with_source_label.json" \
  --output "$HOME/Downloads/ragas_v1_${DATE}.xlsx"
```

Expected: 50건 평가 + summary 시트.

- [ ] **Step 3: v2 측정**

```bash
docker exec backend-postgres-1 psql -U truewords -d truewords \
  -c "UPDATE chatbot_configs SET collection_main='malssum_poc_v2' WHERE chatbot_id='all';"
# 캐시 비우기 다시
curl -sS -X POST 'http://localhost:6333/collections/semantic_cache/points/delete' \
  -H 'content-type: application/json' -d '{"filter":{}}'

DATE2=$(date +%Y%m%d_%H%M)
PYTHONPATH=. uv run python scripts/eval_ragas.py \
  --seed "$HOME/Downloads/ragas_eval_seed_50_with_source_label.json" \
  --output "$HOME/Downloads/ragas_v2_${DATE2}.xlsx"
```

- [ ] **Step 4: A/B 비교 xlsx 생성** — 기존 `merge_eval_compare.py`는 NotebookLM 포맷용이라 RAGAS xlsx에는 안 맞음. 즉석 비교 스크립트:

```bash
uv run python <<'PY'
from openpyxl import load_workbook, Workbook
import os, sys
v1 = load_workbook(os.path.expanduser(f"~/Downloads/ragas_v1_${DATE}.xlsx"), data_only=True).active
v2 = load_workbook(os.path.expanduser(f"~/Downloads/ragas_v2_${DATE2}.xlsx"), data_only=True).active
def rows(ws):
    rs = list(ws.iter_rows(values_only=True))
    h = list(rs[0]); return h, [dict(zip(h, r)) for r in rs[1:] if r and r[0] is not None]
h1, r1 = rows(v1); h2, r2 = rows(v2)
m1 = {r['id']: r for r in r1}; m2 = {r['id']: r for r in r2}
out = Workbook(); ws = out.active; ws.title = "v1_vs_v2"
ws.append(["id","question","fa_v1","fa_v2","fa_d","cp_v1","cp_v2","cp_d","cr_v1","cr_v2","cr_d","ar_v1","ar_v2","ar_d"])
for i in sorted(set(m1)&set(m2)):
    a, b = m1[i], m2[i]
    fa = (a.get('faithfulness',0), b.get('faithfulness',0))
    cp = (a.get('context_precision',0), b.get('context_precision',0))
    cr = (a.get('context_recall',0), b.get('context_recall',0))
    ar = (a.get('answer_relevancy',0), b.get('answer_relevancy',0))
    ws.append([i, a.get('question',''), fa[0], fa[1], fa[1]-fa[0], cp[0], cp[1], cp[1]-cp[0], cr[0], cr[1], cr[1]-cr[0], ar[0], ar[1], ar[1]-ar[0]])
DATE = os.environ.get('DATE2', os.environ.get('DATE', 'now'))
out.save(os.path.expanduser(f"~/Downloads/ragas_v1_vs_v2_{DATE}.xlsx"))
print('A/B 비교 저장')
PY
```

---

#### Task 17: NotebookLM 200건 v2 재측정 (옵션 D 스크립트 재사용)

**Files:**
- Create: `~/Downloads/notebooklm_v2_<date>_*.xlsx` × 6 (light100/cheonilguk50/chambumo50 결과 + compare + analysis)

- [ ] **Step 1: 옵션 D Task 5~7 그대로 재실행** — 본 plan은 옵션 D plan(`/Users/woosung/.claude/plans/downloads-truewords-phase-2-handoff-md-refactored-hickey.md`)의 Task 5~7과 동일 명령. 단 출력 파일명은 `notebooklm_v2_*` 접두사 사용.

```bash
# semantic_cache 비우기는 RAGAS A/B 직후라 이미 비어 있을 수 있음 — 새로 비움
curl -sS -X POST 'http://localhost:6333/collections/semantic_cache/points/delete' \
  -H 'content-type: application/json' -d '{"filter":{}}'

DATE=$(date +%Y%m%d_%H%M)

# Light + 통일원리 100건
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
  --light "$HOME/Downloads/Light RAG 성능 평가를 위한 단계별 테스트 Q&A 50선.xlsx" \
  --level5 "$HOME/Downloads/통일원리 및 RAG 성능 평가용 5단계 숙련도 테스트 세트.xlsx" \
  --output "$HOME/Downloads/notebooklm_v2_${DATE}_light100.xlsx" \
  --chatbot-id all

# 천일국 50건
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
  --input "$HOME/Downloads/천일국 섭리 승리를 위한 신앙 문답 가이드.xlsx" \
  --output "$HOME/Downloads/notebooklm_v2_${DATE}_cheonilguk50.xlsx" \
  --chatbot-id all

# 참부모 50건
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
  --input "$HOME/Downloads/참부모 섭리와 신앙 생활 단계별 Q&A 데이터셋.xlsx" \
  --output "$HOME/Downloads/notebooklm_v2_${DATE}_chambumo50.xlsx" \
  --chatbot-id all
```

- [ ] **Step 2: 카테고리 분석 (옵션 D 분석 스크립트 재사용, baseline = 옵션 D treatment xlsx)**

```bash
DATE_D=20260428_1001  # 옵션 D 측정 DATE (이번 세션의 산출물)
PYTHONPATH=. uv run python scripts/analyze_notebooklm_categories.py \
  --baseline "$HOME/Downloads/notebooklm_post_phase1_${DATE_D}_light100.xlsx" \
  --treatment "$HOME/Downloads/notebooklm_v2_${DATE}_light100.xlsx" \
  --output    "$HOME/Downloads/notebooklm_v2_${DATE}_category_analysis_light100.xlsx"

PYTHONPATH=. uv run python scripts/analyze_notebooklm_categories.py \
  --baseline "$HOME/Downloads/notebooklm_post_phase1_${DATE_D}_cheonilguk50.xlsx" \
  --treatment "$HOME/Downloads/notebooklm_v2_${DATE}_cheonilguk50.xlsx" \
  --output    "$HOME/Downloads/notebooklm_v2_${DATE}_category_analysis_cheonilguk50.xlsx"

PYTHONPATH=. uv run python scripts/analyze_notebooklm_categories.py \
  --baseline "$HOME/Downloads/notebooklm_post_phase1_${DATE_D}_chambumo50.xlsx" \
  --treatment "$HOME/Downloads/notebooklm_v2_${DATE}_chambumo50.xlsx" \
  --output    "$HOME/Downloads/notebooklm_v2_${DATE}_category_analysis_chambumo50.xlsx"
```

---

#### Task 18: A/B 보고서 + 종료 기준 검증

**Files:**
- Create: `docs/dev-log/2026-04-28-contextual-retrieval-ab.md`

- [ ] **Step 1: 종료 기준 데이터 수집** (인계서 §5)

| 메트릭 | 출처 | baseline (옵션 D) | v2 | 목표 |
|---|---|---|---|---|
| RAGAS Faithfulness | `ragas_v1_vs_v2_*.xlsx` summary | 0.546 | ? | **0.65+** |
| RAGAS Context Recall | 동상 | 0.425 | ? | **0.55+** |
| NotebookLM L5 hit율 | `notebooklm_v2_*_category_analysis_light100.xlsx` | 0.05 | ? | **0.12+** |
| NotebookLM L1 hit율 | 동상 | 0.85 | ? | **0.85 유지** |

- [ ] **Step 2: 보고서 작성**

내용:
- 산출물 절대경로 (RAGAS 3 xlsx + NotebookLM 6 xlsx + 카테고리 분석 3 xlsx)
- 종료 기준 표 (위 4개 메트릭의 v1/v2 + 목표 충족 여부)
- 인계서 §5 종료 기준 6개 모두 체크 (xlsx 파일/스크립트/dev-log/pytest)
- 향후 옵션 F (청킹 PoC) / 옵션 H (Citation eval) 권고 (수치에 따라)

- [ ] **Step 3: commit**

```bash
git add docs/dev-log/2026-04-28-contextual-retrieval-ab.md
git commit -m "docs(eval/b): contextual retrieval A/B report — RAGAS + NotebookLM v1 vs v2"
```

---

### Group F — 정리 + PR (0.5일)

#### Task 19: 회귀 슈트 통과 확인

**Files:**
- 변경 없음

- [ ] **Step 1: 신규 테스트 모두 PASS 확인**

```bash
uv run pytest tests/scripts/ tests/pipeline/test_ingestor_prefix.py tests/chatbot/test_collection_main_field.py tests/chat/test_collection_main_routing.py -v
```

Expected: 12+ passed (Task 2/5/6/7/9/14의 신규 테스트 합).

- [ ] **Step 2: 백엔드 전체 슈트 — main HEAD 5건 회귀는 분리 PR로 처리됨을 명시**

```bash
uv run pytest -q
```

Expected: 본 plan의 신규 테스트 모두 PASS. main HEAD `c2bb05b` 자체의 5 failure는 **본 plan과 무관**, 별도 PR (옵션 D 보고서 §5 참조).

---

#### Task 20: dev-log 통합 + push + PR (사용자 승인 필요)

**Files:**
- Create: `docs/dev-log/2026-04-28-option-b-and-g.md` (분기 #2 진입 + 본 plan 종료 통합)

- [ ] **Step 1: 통합 dev-log 작성** — Group A~F의 모든 산출물을 한 dev-log에 정리:

내용 골격:
- 진입 근거 (옵션 D 결과 + 분기 #2)
- Group A~F 별 산출물 절대경로
- 종료 기준 4개 메트릭 v1 vs v2 표
- main 5건 회귀는 별도 PR로 처리됨을 명시

- [ ] **Step 2: dev-log commit**

```bash
git add docs/dev-log/2026-04-28-option-b-and-g.md
git commit -m "docs(phase-2): option B + G complete — Contextual Retrieval + Source Ablation report"
```

- [ ] **Step 3: 사용자 승인 받고 push**

```bash
# 사용자 승인을 받은 뒤에만 실행
git push -u origin feat/phase-2-contextual-retrieval-and-source-ablation
gh pr create --title "feat(phase-2): Option B (Contextual Retrieval) + G (Source Ablation)" --body "$(cat <<'EOF'
## Summary
- 옵션 B: Anthropic Contextual Retrieval — 18만 청크에 50~100토큰 prefix 부여 후 새 컬렉션 `malssum_poc_v2` 재인덱싱
- 옵션 G: Source-weight ablation — 시드 50건 gold_source 라벨링 + per-source 4메트릭 매트릭스
- 종료 기준: RAGAS Faithfulness 0.546→<측정값>, Context Recall 0.425→<측정값>, NotebookLM L5 0.05→<측정값>

## Test plan
- [ ] `uv run pytest -q` 본 plan 신규 테스트 모두 PASS
- [ ] RAGAS A/B summary 시트 4메트릭 검증
- [ ] NotebookLM v1 vs v2 카테고리 분석 xlsx Level별 delta 검증
- [ ] admin UI에서 'all' 봇 collection_main toggle UI 동작
- [ ] (별도 PR) main HEAD `c2bb05b`의 5건 chat_service/stream_abort 회귀 fix

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification (Phase 2 분기 #2 종료 검증, 인계서 §5)

### 데이터 산출물 (`~/Downloads/`)
- [ ] `per_source_ablation_<date>.xlsx` (옵션 G)
- [ ] `contextual_retrieval_ab_<date>.xlsx` 또는 `ragas_v1_vs_v2_<date>.xlsx` (옵션 B)
- [ ] `notebooklm_v2_<date>_*.xlsx` × 6 (옵션 B NotebookLM 200건)
- [ ] `contextual_prefixes/` ≈ 615 JSONL (Group C 산출)

### 코드 / 문서
- [ ] `backend/scripts/eval_per_source.py` + 단위 테스트
- [ ] `backend/scripts/build_contextual_prefix.py` + 단위 테스트
- [ ] `backend/scripts/reindex_with_prefix.py` + 단위 테스트
- [ ] `backend/scripts/create_collection_v2.py`
- [ ] `backend/scripts/label_seed_with_source.py`
- [ ] `backend/src/pipeline/chunker.py` `Chunk.prefix_text` 필드
- [ ] `backend/src/pipeline/ingestor.py` `_build_text_for_embedding` helper + 단위 테스트
- [ ] `backend/src/chatbot/models.py` `ChatbotConfig.collection_main` 필드 + Alembic 마이그레이션
- [ ] `backend/src/chat/service.py` retrieval에 `chatbot_config.collection_main` 전달 + 단위 테스트
- [ ] `admin/src/features/chatbot/components/chatbot-form.tsx` collection_main select
- [ ] `docs/dev-log/2026-04-28-option-b-and-g.md` (통합)
- [ ] `docs/dev-log/2026-04-28-source-ablation.md` (G)
- [ ] `docs/dev-log/2026-04-28-prefix-dryrun.md` (B Task 11)
- [ ] `docs/dev-log/2026-04-28-contextual-retrieval-ab.md` (B Task 18)

### 종료 측정 목표 (수치)
- [ ] RAGAS Faithfulness ≥ **0.65** (baseline 0.546)
- [ ] RAGAS Context Recall ≥ **0.55** (baseline 0.425)
- [ ] Citation Coverage 첫 측정 (옵션 H로 위임 가능 — 본 plan 종료 기준에선 옵션 H 별도)
- [ ] NotebookLM L5 카테고리 hit율 ≥ **0.12** (옵션 D 0.05)
- [ ] NotebookLM L1 카테고리 hit율 유지 (옵션 D 0.85)

### Pytest
- [ ] 신규 12+ 테스트 PASS
- [ ] 본 plan 변경분(`backend/scripts/`, `pipeline/chunker.py`, `pipeline/ingestor.py`, `chatbot/models.py`, `chat/service.py`)에서 회귀 0건
- [ ] (별도 PR로) main HEAD 5건 회귀 fix

---

## Rollback (옵션 B + G 도중 문제 발생 시)

- **Group A G 결과가 모든 source에서 균일** (특정 source 약점 없음) → contextual prefix를 권/카테고리 균등 적용. Task 12 우선순위 분기 생략.
- **prefix dry-run(Task 11) 품질 < 70%** → PROMPT_TEMPLATE 수정 후 max 2회 재시도 (Generator-Evaluator 3회 상한). 그래도 미달이면 Anthropic 원형 프롬프트(영어)를 한국어 답변 강제로 변경 후 1회 추가 재시도.
- **18만 청크 prefix 비용 초과** ($50 초과 예상) → 약점 source 권만 (Task 12 Step 2)으로 한정 진행. 종료 기준 #4 NotebookLM L5는 약점 source에 의존하므로 부분 인덱싱으로도 검증 가능.
- **재인덱싱 도중 Qdrant 디스크 부족** → 기존 `malssum_poc` 컬렉션 보존 + `malssum_poc_v2`만 정리. 운영 봇은 v1 그대로.
- **A/B 평가 결과 v2 < v1** → 보고서에 솔직히 기록 + 인계서 §0의 옵션 E (Cross-encoder reranker) 또는 옵션 F (청킹 재설계)로 분기.

---

## 후속 (본 plan 범위 밖)

- 옵션 F (청킹 자연 단위 PoC, 1~2일) — B 결과가 미흡하면 인계서 §4-F
- 옵션 H (Citation enforcement eval, 1~2일) — Faithfulness 정밀 분해, 인계서 §4-H
- main HEAD `c2bb05b` 5건 회귀 fix — 별도 PR
