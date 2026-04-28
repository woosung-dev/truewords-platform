# Phase 2 옵션 B (Contextual Retrieval) + G (Source Ablation) — A/B 통합 보고서

> **세션**: 2026-04-28 (Phase 2 본 세션)
> **브랜치**: `feat/phase-2-contextual-retrieval-and-source-ablation`
> **베이스라인**: 옵션 D 측정 (`docs/dev-log/2026-04-28-phase-1-eval-report.md`)
> **A/B**: `malssum_poc` (v1 baseline) vs `malssum_poc_v2` (Anthropic Contextual Retrieval prefix prepended)

---

## 0. 한 줄 결론

> **(채워질 예정)** — RAGAS 4메트릭과 NotebookLM L5 기준 PASS/FAIL.

---

## 1. 산출물

### 코드 (이 브랜치 commit으로 보존)
- `backend/scripts/build_contextual_prefix.py` — concurrent mode (asyncio.Semaphore + as_completed)
- `backend/scripts/dump_chunks_to_jsonl.py` — Qdrant scroll → 권별 JSONL (NFC 충돌 처리 포함)
- `backend/scripts/reindex_with_prefix.py` — JSONL → Chunk → ingest_chunks(v2) (prev session)
- `backend/src/pipeline/chunker.py` — `Chunk.prefix_text` 필드 (prev session)
- `backend/src/pipeline/ingestor.py` — `_build_text_for_embedding` prefix prepend (prev session)
- `backend/src/chatbot/{models,service}.py` + alembic 마이그레이션 — `collection_main` 컬럼 (prev session)

### 단위 테스트 (PASS)
- 이전 세션 16개 + 본 세션 신규 10개 (build_contextual_prefix concurrent 3 + dump_chunks 7) = **26개 PASS**

### 데이터 (`~/Downloads/`)
- `contextual_prefixes/` — 96권 / 74,341 prefix JSONL (concurrency=60 paid tier, ~Xh)
- `ragas_eval_v1_v2_<DATE>.xlsx` — 50건 v1 vs v2 4메트릭 비교
- `notebooklm_v2_<DATE>_{light100,cheonilguk50,chambumo50}.xlsx` (3 raw)
- `notebooklm_v2_<DATE>_category_analysis_*.xlsx` (3 분석)

### Qdrant 컬렉션
- `malssum_poc` (v1 baseline): 74,341 points (사용자 데이터 기존 그대로)
- `malssum_poc_v2` (treatment): 74,341 ± 1% points, prefix prepended embedding

### A/B 라우팅
- `chatbot_configs.collection_main`로 봇별 컬렉션 토글
- 'all' 봇 → `malssum_poc_v2` (A/B 측정 동안)

---

## 2. 데이터 환경 발견 (핵심)

### 인계서 "615권" 정정 → **96권** 74,341청크
- malssum_poc 실측: 96 unique volumes
- 상위 5: 평화경(7869) + 천성경(7418) + 통일사상(2441) + 원리강론(1937) + 참어머님 말씀모음(1391)
- 권 분포: 말씀선집 001~030 (30권) + 그 외 종류별 단일권 + 참어머님 말씀 시리즈

### NFC/NFD 중복 데이터 발견
- 2건 권명이 NFC/NFD 두 형태로 적재됨 (각 동일 청크 수):
  - `말씀선집 002권.pdf` × 2 (각 855청크)
  - `11월 2일 참어머님 말씀.txt` × 2 (각 5청크)
- 본 작업의 dump_chunks_to_jsonl.py는 `_dup1` 접미사로 모두 보존 → 재인덱싱 시에도 동일 청크가 v2에 그대로 적재되어 A/B 형평성 유지.
- **후속 권고**: malssum_poc 데이터 정합성 점검 별도 작업으로 분리 (chore PR).

---

## 3. 종료 기준 4메트릭 표

> 전부 채워지면 §0 "한 줄 결론"에 PASS/FAIL 통합.

| 메트릭 | baseline (옵션 D) | v2 (Contextual) | 목표 | 결과 |
|---|---:|---:|---:|:---:|
| RAGAS Faithfulness | 0.546 | **(채워질 예정)** | ≥ 0.65 | TBD |
| RAGAS Context Recall | 0.425 | **(채워질 예정)** | ≥ 0.55 | TBD |
| NotebookLM L5 hit율 | 0.050 | **(채워질 예정)** | ≥ 0.12 | TBD |
| NotebookLM L1 hit율 | 0.850 | **(채워질 예정)** | 유지 (≥ 0.85) | TBD |

추가 RAGAS 메트릭 (참고):
| 메트릭 | baseline | v2 | 변화 |
|---|---:|---:|---:|
| Context Precision | TBD | TBD | TBD |
| Answer Relevancy | TBD | TBD | TBD |

---

## 4. NotebookLM 200 카테고리 분해 (옵션 D 비교)

### Light + 통일원리 100건 (Level별)

| Level | n | baseline | v2 | delta |
|---|---:|---:|---:|---:|
| L1 단순 사실 조회 | 20 | 0.850 | TBD | TBD |
| L2 출처 인용 | 20 | 0.850 | TBD | TBD |
| L3 주제 요약 | 20 | 0.600 | TBD | TBD |
| L4 개념 연결 | 20 | 0.450 | TBD | TBD |
| L5 교리 추론 | 20 | 0.050 | TBD | TBD |

### 천일국 + 참부모 100건

> 카테고리별 분해는 옵션 D 보고서와 동일 형식. 세부는 별도 시트 참조.

---

## 5. 옵션 G — Source Ablation (per-source hit율)

> 약점 source 파악으로 prefix가 어디에 효과가 있었는지 추적.

| Source | n_chunks | baseline hit율 | v2 hit율 | delta |
|---|---:|---:|---:|---:|
| M (3대 경전: 평화경+천성경+참부모경) | TBD | 0.500 | TBD | TBD |
| O (말씀선집 001~030권) | TBD | 0.308 | TBD | TBD |
| B (어머니말씀 모음) | TBD | TBD | TBD | TBD |
| 기타 (통일사상/원리강론/...) | TBD | TBD | TBD | TBD |

옵션 D에서 약점으로 식별된 **M (회귀 -0.100), O (절대 0.308 최저), B**가 prefix로 회복되는지가 본 옵션 B의 핵심 검증.

---

## 6. 의사결정 다이어리

| 결정 | 시각 | 이유 |
|---|---|---|
| Gemini Batch API 우회 (Plan §Task 12a 대신 asyncio.Semaphore + gather) | 14:08 | `GEMINI_TIER=paid` RPM 1000 여유 → 동시 단발 호출이 코드 100줄 추가로 가능, batch polling/parsing 인프라 불필요 |
| 인계서 "615권" → 실측 "96권" 갱신 | 14:15 | malssum_poc scroll 결과 96 volumes 74,341 chunks. 처리 시간 추정 1/2 단축 |
| concurrency 20 → 60 상향 | 14:24 | 초기 throughput 0.45 chunks/s 측정 → 9.7 chunks/s 도달 후 60으로 추가 상향 → 16 chunks/s |
| NFC/NFD 중복 권명 보존 (`_dup1` 접미사) | 14:22 | macOS FS auto-merge로 860청크 손실 → A/B 형평성 위해 분리 보존 |
| 회귀 PR 분리 (`fix/chat-service-mock-regression`) | 14:00 | 본 옵션 B 작업과 무관 (PR #68 IntentClassifierStage mock 누락) |
| RAGAS 0.4.3 hang 디버깅 보류 | 14:25 | dry-run 50건 OK 확인. RunConfig 명시 시 hang 알려진 이슈, default 유지가 안전 |

---

## 7. 다음 단계

### 즉시 (본 PR 머지 후)
- [ ] 회귀 fix PR 머지 (`fix/chat-service-mock-regression`) — 본 작업과 무관
- [ ] malssum_poc NFC/NFD 중복 데이터 정합성 chore PR (선택)

### Phase 2 잔여 (B/G 외)
- [ ] 옵션 F: 청킹 PoC 1권 샘플 (token-based 1024 vs sentence-based)
- [ ] 옵션 H: `backend/scripts/citation_metrics.py` PoC — citation coverage / unsupported claim rate

### Phase 3 (분기 결정 후)
- 옵션 B/G 결과에 따라 분기 #2(B+G 병행 권고, 옵션 D 결론) 또는 분기 #3(전체 재학습) 채택.

---

## 8. 재현 가이드

### Prefix 생성
```bash
cd backend
PYTHONPATH=. uv run python scripts/dump_chunks_to_jsonl.py \
    --collection malssum_poc --output-dir /tmp/all_chunks_jsonl
PYTHONUNBUFFERED=1 PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \
    --input-dir /tmp/all_chunks_jsonl \
    --output-dir ~/Downloads/contextual_prefixes \
    --mode concurrent --concurrency 60
```

### v2 재인덱싱 + A/B 토글
```bash
PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \
    --input-dir ~/Downloads/contextual_prefixes
docker exec backend-postgres-1 psql -U truewords -d truewords -c \
    "DELETE FROM semantic_cache_entries;
     UPDATE chatbot_configs SET collection_main='malssum_poc_v2' WHERE chatbot_id='all';"
```

### NotebookLM 200 v2
```bash
PYTHONPATH=. uv run python scripts/eval_notebooklm_qa.py \
    --light  "~/Downloads/Light RAG 성능 평가를 위한 단계별 테스트 Q&A 50선.xlsx" \
    --level5 "~/Downloads/통일원리 및 RAG 성능 평가용 5단계 숙련도 테스트 세트.xlsx" \
    --output ~/Downloads/notebooklm_v2_<DATE>_light100.xlsx \
    --chatbot-id all --api-base http://localhost:8000
# (천일국 + 참부모 동일 패턴, 입력 xlsx만 변경)
```

### RAGAS v2
```bash
PYTHONPATH=. uv run python scripts/sample_eval_pairs.py --output-dir ~/Downloads
# (v2 xlsx로부터 50건 시드 생성)
PYTHONPATH=. uv run --group eval python scripts/eval_ragas.py \
    --seed ~/Downloads/ragas_eval_seed_50_v2_<DATE>.json \
    --output ~/Downloads/ragas_eval_v1_v2_<DATE>.xlsx
```
