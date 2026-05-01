# 2026-05-01 — Target Architecture Blueprint vs 실제 코드 차이 (ADR)

## TL;DR

`docs/04_architecture/target-architecture-blueprint-2026-05-01.html` (외부 자료의 repo 사본, 시점 고정 참고용) 가 진단한 항목 중 **여러 곳이 실제 코드와 불일치**. 본 ADR 은 사실/허구를 분리 기록한다.

원본 청사진은 그대로 (수정 X), 실제 코드 기준 차이는 본 ADR 에 기록 — 변경 이력·리뷰 가능성 확보.

---

## 1. 청사진 vs 실제 코드 차이 표

| 청사진 원문 | 실제 코드 | 출처 | 판정 |
|---|---|---|---|
| "score_threshold 0.60" 적신호 — 5개 버그 중 하나 | 운영 적용값은 `0.1` (RRF 점수대 0.0~0.5 에 합리적). 0.75 는 dead default | `chatbot/service.py:85`, `chatbot/schemas.py:21`, `runtime_config.py:18` | ❌ 청사진 진단 오류 |
| "REWRITE_TIMEOUT 0.8s → 1.8s" | 현재 `1.5s` (이미 0.8 → 1.5 로 조정됨) | `search/query_rewriter.py:42` | ⚠️ 청사진 정보가 outdated |
| "유사도 ≥ 0.93" cache | 현재 `0.88` | `config.py:41` | ⚠️ 청사진 정보가 outdated |
| "5.0 RetrievalGate (신규)" | `IntentClassifierStage` 가 META 차단 부분 구현 | `chat/pipeline/stages/intent_classifier.py` | △ 부분 흡수, 추가 분기는 신규 |
| "11 Stage" / "12 Stage" 표기 | 실제 **12 Stage** (codex 검증) | `chat/service.py` | ⚠️ 청사진 표기 분산 |
| "dense vector only (Qdrant)" 같은 비교 — TrueWords 에 hybrid 부재 함의 | 이미 **Dense + Sparse RRF hybrid** | `search/hybrid.py:65` | ❌ 청사진 진단 오류 |
| "9봇 자동 선택" 가정 | 운영 활성 봇 수는 메모리상 PoC 봇 4개 비활성 처리 (PR #87) | `docs/dev-log/52-collection-main-deprecation.md` | ⚠️ 청사진 가정과 운영 현황 다름 |

## 2. 청사진의 강점 — 학계/업계 정설 일치

WebSearch + arXiv 조사 결과 청사진의 큰 방향은 학계 정설과 일치:

| 청사진 항목 | 학계 근거 |
|---|---|
| 5.0 RetrievalGate (NO/SINGLE/MULTI_STEP) | Adaptive-RAG (Jeong et al., ICLR 2024) https://arxiv.org/abs/2403.14403 |
| 5.5 QueryRouting TF-IDF + SVM F1 0.928 | Lightweight Query Routing for Adaptive RAG https://arxiv.org/abs/2604.03455 |
| 8. parallel_fusion RRF / Convex Combination | Microsoft Azure / OpenSearch 표준 / arXiv 2210.11934 (CC 우위는 라벨 있을 때) |
| 9. Cross-encoder Reranker | Anthropic Contextual Retrieval (https://www.anthropic.com/news/contextual-retrieval) |
| 10. ValidationStage (Self-Reflective) | Self-RAG, ICLR 2024 Oral (https://arxiv.org/abs/2310.11511) — 단 학습된 LM 기반 |

→ 큰 방향성에는 동의. 단, 작은 진단 오류와 누락 항목은 본 ADR 로 정정.

## 3. 청사진이 누락한 항목

| 누락 항목 | 근거 | 종교 도메인 적합도 |
|---|---|---|
| Anthropic Contextual Retrieval 청크 컨텍스트 prepend | 67% 실패율 감소 (Anthropic 2024) | 메모리상 PR #92 보류 (운영 안정화 우선) — 운영 안정화 후 재평가 |
| RAG-Fusion (Multi-Query) | Rackauckas 2024 — LLM 으로 다중 쿼리 후 RRF | 단일 query rewrite 보다 강력 (단 비용 증가) |
| Late Chunking (Jina) | arXiv 2409.04701 | Contextual Retrieval 의 컴퓨팅 절감 대안 |
| 3-tier Reranker | Perplexity production 아키텍처 | 단일 rerank 로 충분할 수 있음 |
| RAGAS 자동 평가 | 2025 production RAG 표준 | **사용자 반대 — judge LLM 비용 부담, CI/CD 통합 영구 폐기 (2026-05-01)** |

## 4. SaaS 벤치마킹 — NotebookLM vs Perplexity vs TrueWords

| 항목 | NotebookLM | Perplexity | TrueWords (2026-05-01) |
|---|---|---|---|
| 검색 | hybrid (BM25 + vector) | hybrid 6단계 | **Dense + Sparse RRF hybrid (Qdrant)** |
| Reranker | rerank 적용 | 3-tier reranker | Gemini LLM JSON (개선 후보) |
| Query 처리 | rewriting | LLM intent parsing | rule + 하드코딩 사전 |
| Citation | 강제 인라인 | 사전임베딩 | 출처 명시 prompt |
| 특이점 | "source grounding" 용어 사용 | Vespa.ai 단일 엔진 | Stage 체인 + FSM 구조 |

## 5. 본 ADR 의 운영 의의

- 청사진의 진단 오류 (`0.60`, `dense only`) 가 향후 plan/PR 에 재인용되지 않도록 사실 동결
- 청사진의 outdated 정보 (`0.8s`, `0.93`) 가 새 변경의 근거로 잘못 사용되지 않도록 시점 표시
- 청사진의 큰 방향성 (Adaptive RAG, hybrid fusion, cross-encoder rerank) 에 대한 동의 기록
- **외부 자료 직접 수정 절대 금지** 원칙 — 사본은 시점 고정 참고용. 차이는 ADR 로만 기록.

## 6. 후속 작업 우선순위 (Phase 0 머지 후)

별도 PR 로 진행:

1. cascade `score_threshold` cutoff 공식 — 분포 데이터 기반 결정 (본 PR 의 후속)
2. `0.75` dead default 정리 (`runtime_config.py:18`, `config.py:45`)
3. Cross-encoder Reranker (BGE-v2-m3 vs Cohere) — Phase 1
4. RetrievalGate — `IntentClassifierStage` 확장 (신규 Stage 신설 X)
5. QueryRouting — SessionMessage 로그 라벨링 후
6. Convex Combination 옵션 — 라벨 평가셋 안정화 후
7. Anthropic Contextual Retrieval — 인덱싱 비용 측정 후 재평가
8. ValidationStage — CRAG 류 별도 실험

## 7. 영구 폐기 결정

- ❌ RAGAS 등 judge LLM 평가 CI/CD 통합 — 비용 부담으로 사용자 반대 (2026-05-01)

## 8. 참고

- 외부 청사진 원본: `~/Downloads/truewords_target_architecture.html`
- 청사진 repo 사본: `docs/04_architecture/target-architecture-blueprint-2026-05-01.html`
- 설정 전파 경로 ADR: `docs/dev-log/2026-05-01-cascade-threshold-paths.md`
- Codex consult mode 검토 결과: session `019de19a-04ff-7571-8132-0dca4f8d4046`
