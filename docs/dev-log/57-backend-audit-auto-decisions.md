# 백엔드 정합화 audit — 자동 선택 결정 기록

- 날짜: 2026-05-15
- plan: `~/.claude/plans/rules-1-robust-galaxy.md`
- audit: 5인 병렬 (general-purpose A / B / C / D + codex E)
- 5인 평균 점수: 6.65 / 10
- 통합 브랜치: `dev/backend-audit`

## Phase 2 finding 합본

- P0 9건 (룰 직접 위반 + 안전성 위험)
- P1 14건 (룰 정신 위반 / 권장 패턴 어긋남, P1-11 청사진 / P1-12 룰 amendment 사후 처리)
- P2 12건 (별도 backlog)
- P3 6건 (관찰)

## 사용자 확정 결정 (Phase 3)

1. 작업 흐름 = 통합 브랜치 `dev/backend-audit` + dimension 별 sub-PR (★★★★★)
2. 우선순위 = P0 + P1 (★★★★★)
3. 청사진 신규 stage (P1-11) = 별도 plan 분리 (★★★★★)

## 자동 선택 5건 (실행 단계 [확인 필요])

| # | 결정 | 선택 | 사유 |
|---|------|------|------|
| 1 | Sub-PR A · P0-9 SSE safety 재설계 | (a) chunk 단위 incremental sanitizer | streaming UX 유지 + safety 보장. plan 권장 |
| 2 | Sub-PR D · P0-1 SENSITIVE_PATTERNS 채우기 | (b) PoC 기본 PII (전화/주민/카드/이메일/주소) 우선 | 도메인 전문가 합류 전 즉시 안전성 효과. 종교 패턴은 별도 trigger |
| 2-정정 | (1차 머지 시점 implementation drift) | 실제 구현은 전화/주민/카드 3종 → 이메일/주소는 2차 audit S-6 에서 추가 | drift 정정 audit trail. 결정 로그 vs 실 구현 차이는 1차 머지 직후 codex round-1 P1 9/10 으로 발견. 본 audit (2026-05-15) 의 sub-PR `feat/backend-audit-2-s2-safety` (통합 브랜치 `dev/backend-audit-2`) 에서 정정. 상세 `docs/dev-log/59-second-audit-auto-decisions.md` §2 |
| 3 | Sub-PR D · P0-2 input_validator 47 출처 | (b) 룰 §2.1 갱신 + 패턴 로드맵 | 47 출처 미확인 (blueprint copy 추정). 실측 23 인정 + 단계적 확장 명문화 |
| 4 | Sub-PR D · P1-14 CORE_TERMS 확장 | (b) 30~50개 단기 확장 | 100~200 한 번에는 도메인 자문 필수. 단기 확장 후 별도 trigger |
| 5 | Sub-PR E · 캐시 임계값 | (a) ADR 후 config `0.93` 정렬 | 룰 `0.93` 기준 정합. `0.88` (운영 hit-rate 우선) 결정 사유 추적 ADR 작성 |

## Sub-PR 작업 순서 (의존 분석)

```
B (작고 회귀 좁음, 흐름 검증)
  → A (SSE safety 재설계 critical; D 패턴 채우기 전 선행 필수)
    → D (SafetyOutput 패턴 + 도메인 갭)
      → C (qdrant 통합 + data_router 분할, 광범위)
        → E (문서 / 룰, 코드 영향 0)
```

순서 핵심: **D → A 의존** — D 에서 `SENSITIVE_PATTERNS` 채우는 순간 P0-9 (SSE 누출) 가 실 발생. A 의 incremental sanitizer 가 먼저 들어가야 안전.

## 통합 PR (main 머지) 검증 절차

1. `uv run pytest` 전체 274 + Sub-PR A SSE safety 골든셋 + Sub-PR D safety/CORE_TERMS — green
2. `ruff` + `mypy` 신규 type 위반 0
3. E2E smoke: `/chat`, `/chat/stream`, `/chat/feedback`, `/api/chat/messages/{id}/reactions`, `/admin/auth/login`, `/logout`, `/admin/settings/config`, `/admin/analytics/*`, `/admin/data-sources/upload`, `/admin/data-sources/jobs`
4. Cloud Run staging 5분 canary — qdrant 통합 (P0-7) + ingest worker (P0-8) + SSE safety (P0-9) 영향 확인

## 본 plan 미포함 (별도 작업)

- P1-11 청사진 12-stage 신규 (5.0 RetrievalGate / 5.5 QueryRouting / 10 Validation / parallel_fusion / cross-encoder reranker) → 별도 plan
- P2 12건 → 별도 BL
- 도메인 전문가 자문 (종교 SENSITIVE_PATTERNS 확장 / CORE_TERMS 100~200 확장) → 별도 trigger
- Flutter / admin frontend / 운영 데이터 마이그레이션
