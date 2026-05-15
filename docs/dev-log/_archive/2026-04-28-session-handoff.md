# Phase 2 본 세션 종료 인계 (2026-04-28)

> **다음 세션 시작 시 이 문서부터 읽으세요.** 진행 상황 + 시나리오 A 시간표 + 다음 첫 task 바로가기.

---

## 0. 본 세션 결과 한 줄

**옵션 D 완료 + 옵션 G PoC 완료 + 옵션 B 인프라·스크립트 완료 + 평화경 50청크 dry-run/sanity 완료**. 본 18만 청크 prefix 생성과 615권 v2 재인덱싱은 **다음 세션 시작 작업**.

---

## 1. 작업 환경 (다음 세션 점검 명령)

```bash
cd /Users/woosung/project/agy-project/truewords-platform
git checkout feat/phase-2-contextual-retrieval-and-source-ablation
git log --oneline main..HEAD | head -20  # 15 commit 확인 (f6a00d2 ~ e772ebe)

# Docker
docker ps                        # backend-postgres-1 + backend-qdrant-1 healthy
curl -sS http://localhost:8000/health        # {"status":"ok"}

# Qdrant 컬렉션 (3개)
curl -sS http://localhost:6333/collections | python3 -m json.tool | grep name
# → malssum_poc, malssum_poc_v2 (50 sanity points), semantic_cache

# DB 마이그레이션 적용됨
docker exec backend-postgres-1 psql -U truewords -d truewords \
  -c "\d chatbot_configs" | grep collection_main
# → collection_main | character varying | not null | 'malssum_poc'::character varying
```

---

## 2. 핵심 산출물 위치

### 코드 (이 브랜치 commit으로 보존)
- `backend/scripts/label_seed_with_source.py` — 시드 source 라벨링
- `backend/scripts/eval_per_source.py` — RAGAS per-source (RAGAS hang으로 보류 사용)
- `backend/scripts/analyze_per_source_hit_rate.py` — NotebookLM 휴리스틱 source 분해
- `backend/scripts/analyze_notebooklm_categories.py` — Level 분해 (옵션 D)
- `backend/scripts/build_contextual_prefix.py` — prefix 생성 (oneshot only, **batch mode 미구현**)
- `backend/scripts/create_collection_v2.py` — malssum_poc_v2 생성 헬퍼
- `backend/scripts/reindex_with_prefix.py` — JSONL → Chunk → ingest_chunks(v2)
- `backend/src/pipeline/chunker.py` — `Chunk.prefix_text: str = ""` 필드 추가
- `backend/src/pipeline/ingestor.py` — `_build_text_for_embedding` helper + 라인 154 적용
- `backend/src/chatbot/models.py` — `ChatbotConfig.collection_main: str = "malssum_poc"`
- `backend/alembic/versions/c59c535a2200_add_collection_main_to_chatbot_configs.py`
- `backend/src/chatbot/service.py` — build_runtime_config의 collection_main 라우팅
- `admin/src/features/chatbot/components/chatbot-form.tsx` + `types.ts` — 컬렉션 select UI

### 단위 테스트 (16개 PASS)
- `backend/tests/scripts/test_eval_per_source.py` (3)
- `backend/tests/scripts/test_analyze_per_source_hit_rate.py` (4)
- `backend/tests/scripts/test_analyze_notebooklm_categories.py` (3)
- `backend/tests/scripts/test_build_contextual_prefix.py` (5)
- `backend/tests/scripts/test_reindex_with_prefix.py` (4)
- `backend/tests/pipeline/test_ingestor_prefix.py` (3)
- `backend/tests/chatbot/test_collection_main_field.py` (2)
- `backend/tests/chatbot/test_collection_main_routing.py` (2)

### 데이터 (~/Downloads/)
- `notebooklm_post_phase1_20260428_1001_*.xlsx` × 9 (옵션 D 측정·머지·분석)
- `per_source_hit_rate_20260428_1131_{baseline,treatment}.xlsx` (옵션 G)
- `ragas_eval_seed_50_with_source_label.json` (gold_source 50건)
- `contextual_prefix_dryrun_평화경_20260428_1146.jsonl` (50청크 prefix dry-run)

### dev-log
- `docs/dev-log/2026-04-28-phase-2-plan.md`
- `docs/dev-log/2026-04-28-phase-1-eval-report.md` (옵션 D)
- `docs/dev-log/2026-04-28-source-ablation.md` (옵션 G)
- `docs/dev-log/2026-04-28-prefix-dryrun.md` (옵션 B 평화경 dry-run)
- `docs/dev-log/2026-04-28-session-handoff.md` ← 본 문서

### plan
- `docs/superpowers/plans/2026-04-28-option-b-and-g.md` (1700+줄, Progress 섹션 + Task 12a Batch API 변환 spec 포함)

---

## 3. 다음 세션 시작 즉시 할 일 (시나리오 A)

### 다음 세션 #1 (3~4h 작업 + 12~24h 백그라운드)

**1) Plan §Group C Task 12a 따라서 진행**:
- `backend/src/pipeline/batch_embedder.py` + `batch_service.py:111-171` 패턴 검토
- `build_contextual_prefix.py`에 batch mode 구현 (TDD: `_to_batch_jsonl` / `_submit_batch` / `_poll_until_complete` / `_parse_results`)
- 평화경 7869청크 sanity batch (1~2h 검증)

**2) 약점 source 우선 dump**:
- 약점 = M (3대 경전) / O (말씀선집 615권) / B (어머니말씀) — 합 86% 점유
- Qdrant scroll로 source 필드 기준 필터해 `priority_chunks_jsonl/` 디렉토리 생성
- 약 155k 청크 → batch 1건으로 launch

**3) main HEAD 5건 회귀 fix 별도 PR (병렬, 1~2h)**:
- 실패 테스트:
  - `tests/chat/test_stream_abort.py::TestStreamAbortIntegration::test_stream_abort_force_transitions_to_STREAM_ABORTED`
  - `tests/test_chat_service.py::test_process_chat_without_rerank`
  - `tests/test_chat_service.py::test_process_chat_with_rerank`
  - `tests/test_chat_service.py::test_process_chat_records_rerank_in_search_event`
  - `tests/test_chat_service.py::test_process_chat_empty_results`
- 추정 원인: PR #68 IntentClassifierStage 도입 시 mock 시그니처 미반영

**Background (다음 세션 동안 자동 진행)**: priority batch 12~24h.

### 다음 세션 #2 (prefix 완료 후, 3~4h + 12~15h 백그라운드)

- batch 결과 다운로드 + 권별 jsonl 분리
- `reindex_with_prefix.py --input-dir <priority>` launch (12~15h 백그라운드)
- 그 동안 RAGAS hang 디버깅 시도 (인계서 §7 미완)

### 다음 세션 #3 (재인덱싱 완료 후, 4~5h)

- RAGAS 50 v1 vs v2 (RAGAS hang fix가 됐으면 4메트릭, 아니면 휴리스틱)
- NotebookLM 200 v2 재측정 (옵션 D 스크립트 재사용)
- A/B 통합 보고서 + push + `gh pr create`
- 옵션 F PoC + 옵션 H Citation eval 시작 (시간 여유 시)

---

## 4. 종료 기준 추적 (인계서 §5)

| 메트릭 | baseline (옵션 D) | 목표 | 다음 세션 #3에서 측정 |
|---|---:|---:|---|
| RAGAS Faithfulness | 0.546 | **0.65+** | RAGAS 50 v2 |
| RAGAS Context Recall | 0.425 | **0.55+** | RAGAS 50 v2 |
| Citation Coverage | (옵션 H) | 첫 측정 | 옵션 H 후 |
| Unsupported Claim Rate | (옵션 H) | ≤ 0.15 | 옵션 H 후 |
| NotebookLM L5 hit율 | 0.05 | **0.12+** | NotebookLM v2 |
| NotebookLM L1 hit율 | 0.85 | **유지** | NotebookLM v2 |

---

## 5. 미해결·주의 사항

1. **RAGAS 0.4.3 hang** — 50건 일괄/5건 batch 모두 80%+ TimeoutError. 인계서 §7 "action1+2 timeout 49건" 동일 이슈. 다음 세션에서 별도 디버깅. 임시 fallback: NotebookLM 휴리스틱.
2. **main HEAD 5건 회귀** — 별도 PR 필요. 본 plan과 무관.
3. **Batch API 비용** — 약점 source priority(155k) ~ $5~25. 사용자 GEMINI_API_KEY quota 확인 필요.
4. **stdout 버퍼링** — `uv run python` 백그라운드 시 print buffer가 task close 시점까지 flush 안 됨. 진행 추적은 결과 xlsx/jsonl 생성으로.
5. **untracked 파일 5개** (`backend/scripts/build_ragas_html_report.py` + `docs/dev-log/45/46-input-handling-*.{md,html}` + `screenshots-46/`): 본 세션 무관, 이전 세션 잔여물 — 다음 세션에서 정리.

---

## 6. push / PR 정책 (메모리 룰)

- main에 직접 commit/push 금지 ✓
- feature 브랜치 commit은 자율 ✓ (15 commits 이미 진행)
- **push + `gh pr create`는 사용자 승인 필요** — 다음 세션 #3 끝에서 사용자 승인 받고 진행.

본 인계 문서를 다음 세션 시작 시 다시 읽고 시나리오 A 그대로 진행.
