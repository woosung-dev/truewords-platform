# CLAUDE.md 가이드라인 정렬 — 오버엔지니어링 정리 결과

> 결정일: 2026-05-15
> 통합 브랜치: `dev/cleanup-claude-md-alignment`
> 관련 plan: `~/.claude/plans/behavioral-guidelines-to-streamed-meerkat.md`

## Context

사용자가 `~/.claude/CLAUDE.md` 10가지 행동 가이드라인(특히 §2 Simplicity First, §3 Surgical Changes)에 비추어 truewords-platform 의 오버엔지니어링 의심 지점 전수 audit 요청. 3개 Explore agent 병렬 조사 결과 약 1200~1500 LOC 축약 후보 식별. 6개 Sub-PR 로 분할 계획.

## 실행 결과 — A/B/E 완수, C/D/F SKIP

| Sub-PR | 계획 | 실행 결과 | LOC delta |
|--------|------|-----------|-----------|
| A | Docs/Archive 정리 | ✅ 완수 | -664 (코드) +9 (banner) |
| B | Backend dead code | ✅ 완수 (재범위화) | -870 net |
| C | Stage chain 4 collapse | ⏸️ SKIP | 0 |
| D | Backend layer ceremony | ⏸️ SKIP | 0 |
| E | Admin orphan/wrapper | ✅ 완수 (재범위화) | -52 |
| F | Test 정밀화 | ⏸️ SKIP | 0 |
| **총합** | | | **-977 LOC** + 9 doc banner |

### Sub-PR A (commit `b753154`)
- `docs/dev-log/_archive/` + `docs/superpowers/_archive/` 신설
- 8 stale 문서 archive 이동 (option-b-and-g, phase1-rag-poc, phase2b-search-enhancement, all-queries-explorer, task-1-1-error-handling, weighted-search-design, contextual-retrieval-ab, session-handoff 2건)
- 3 사장 ADR 영구 삭제 (vector-db-comparison, gemini-file-search-analysis, vibe-coding-pinecone-vs-qdrant — 모두 결정 완료, dev-log/메모리에 결과 반영됨)
- 2 architecture doc 에 deprecation banner (`02-architecture-design.md`, `11-data-routing-strategies.md`) — 본문은 historical 기록 보존, 현재 단일 `malssum_poc_v5` + `semantic_cache` 안내

### Sub-PR B (commit `75f9051`)
- `backend/src/qdrant_client.py` shim 영구 제거 (31 LOC) — audit 2차 B-6 후 production 모두 `src.qdrant` 패키지 사용 중
- `backend/scripts/` 16개 + `backend/tests/test_qdrant_setup.py` import 일괄 이관
- `backend/tests/` 6개 파일 mock target 갱신: `src.qdrant_client.get_async_client` → `src.qdrant.factory.get_async_client` (실제 prod 호출 경로 — 기존 patch 는 wrong target 으로 사실상 no-op 이었음)
- `test_boundary_imports.py` B-6 어설션을 "shim 파일 부재 확인"으로 후속화
- `chunk_hierarchical` (v4) 영구 제거 (~80 LOC) — Phase 4 결정 (PR #92) 이후 미호출, `langchain_text_splitters` 미설치로 worktree 환경 pytest 실패 유발
- `tests/test_chunker_hierarchical.py` 8개 테스트 삭제
- `batch_chunk_theology.py` legacy PoC 의 hierarchical method 분기 제거

### Sub-PR E (commit `767c5bc`)
- `admin/src/components/truewords/status-dot.tsx` (52 LOC) 제거 — barrel export 미포함 + 사용처 0건

## 보류 결정의 근거 (Sub-PR C, D, F)

audit 권고를 surgical 원칙(CLAUDE.md §3 "Don't refactor things that aren't broken") 으로 재검토한 결과 **계획된 변경이 의도된 설계를 무너뜨릴 위험** 발견.

### Sub-PR C — Stage chain 4 collapse
- `InputValidationStage`, `EmbeddingStage`, `QueryRewriteStage`, `SafetyOutputStage` 는 thin wrapper 가 아니라 **R1 Phase 3 N3 FSM(`PipelineState`)** 의 일부
- 각 Stage 가 `check_precondition` 호출 + `pipeline_state` 전이 기록
- collapse 시 FSM observability 4 entry 후퇴
- 89 LOC 절약은 cosmetic, 실제 비용은 architecture 정합성 손상

### Sub-PR D — Backend layer ceremony 정리
- **`chat/dependencies.py` lazy-init double-check lock**: `docs/dev-log/46-qdrant-cache-cold-start-debug.md` 에 명시된 의도된 fix. Lifespan event 로 교체 시 PR #73 (Cloudflare Tunnel) 회귀 위험.
- **`analytics_repository.py` (644 LOC) 분할 / `qdrant_service.py` (664 LOC) 분할**: 대형 파일이 cohesive 한지 확인 전엔 분할 결정 불가. CLAUDE.md §3 위반 위험.
- **`datasource/service.py` passthrough 4 inline**: 4줄 제거 위해 router 10곳 호출처 업데이트 churn. 비용 > 효익.
- **`admin/data_router.py` test-only `__all__` 제거**: 6줄 제거 위해 346 LOC 테스트 리팩터 필요. 비용 > 효익.

### Sub-PR F — Test 정밀화
- `test_redteam.py`: class 구조 + 명시된 attack vector 테스트명이 security 시나리오 documentation 역할. parametrize 변환 시 attack 정보 hide.
- `test_input_validator.py`: 동일 패턴 — 입력 패턴별 명시 테스트가 의도된 thoroughness.
- `test_alembic_advisory_lock.py` (287 LOC, 31 tests): 실제 migration concurrency 검증. 스팟 축소 시 race condition 커버리지 손실.
- `test_chat_stream_service.py` (265 LOC): SSE 스트리밍 케이스별 분리 = 정상 thorough 설계.
- audit 의 "over-mocked" 판정은 LOC 기반 cosmetic 지표일 뿐. 테스트는 안전망.

## 학습 (audit 사용에 관한 메타)

3 Explore agent 의 audit 권고 12개 중 **3개 (A/B/E 의 핵심) 만 실효성 있었고, 9개는 cosmetic LOC 지표 기반 false positive** 였다. 향후 audit 결과는:

1. **각 권고를 surgical 원칙(§3)으로 재검토** — "왜 이렇게 되어 있는가?" 의 history (dev-log, comment, memory) 가 의도된 설계임을 보여주는 경우 다수.
2. **LOC 절약은 부산물이지 목표 아님** — cosmetic 축약은 비용 (churn, 회귀 위험) 만 발생.
3. **테스트 코드는 안전망**, 단순 LOC 압축 대상으로 분류 위험.

## 검증

- backend `pytest`: 850 passed / 4 skipped / 1 xfailed / 0 failed (58.74s)
- admin `pnpm test`: 12 files / 97 tests passed (2.44s)
- admin `tsc --noEmit`: 0 error
- 회귀: 0건

## 미수정 / 후속 (별도 PR)

- `chunk_text` / `chunk_paragraph` (v2/v3 chunker) — 5+ legacy ETL 스크립트 의존성 정리 필요
- `qdrant/factory.py:79,90` DEPRECATED 경로 — scripts 마이그레이션 종료까지 보존
- `tmp_match/` (19MB) — gitignore 상태, 메인 worktree 로컬 cleanup 별도 진행
- `docs/TODO.md` Completed 섹션 정리 — surgical scope 외, 일상 운영에서 점진 갱신

## 의사결정 메타 (사용자 confirm 4건)

1. 범위: 전 영역 단계별 (Backend + Admin + Docs)
2. Stage chain collapse: 수행 → 재검토 후 SKIP (FSM 후퇴 회피)
3. tmp_match: 삭제 → 실제로는 gitignore 상태로 git rm 불필요
4. DEPRECATED shim + chunker: 둘 다 제거 → shim 완료, chunker 는 v4 만 제거 (v2/v3 는 scripts 의존성 보존)
5. Sub-PR C 진행: SKIP
6. Sub-PR D 진행: SKIP
7. Sub-PR F 진행: SKIP
