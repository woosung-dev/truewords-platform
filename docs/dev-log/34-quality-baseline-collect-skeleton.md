# dev-log 34 — 품질 기준선 200건 수집 뼈대 (선행 #5)

- **작성일**: 2026-04-25
- **브랜치**: `feat/prereq-5-quality-baseline-skeleton`
- **실행 전제**: staging 또는 운영 Chat API 접근 가능

## 1. 목적

R1/R2/R3 전/후 답변 품질 비교용 baseline 200건 수집 스크립트 + 질문 카탈로그. §19.12 O-6 반영 (LLM judge 는 이번 스코프 외, 수집된 JSONL 을 입력으로 별도 스크립트).

## 2. 카탈로그 구성 (200건)

| 카테고리 | 건수 | 원천 |
|---------|------|------|
| doctrine | 120 | evaluate.py 5 + CORE_TERMS × doctrine_templates 40 + long-form 40 + short-form 35 |
| practice | 50 | CORE_TERMS × practice_templates 30 + practice_extra 20 |
| adversarial | 15 | ADVERSARIAL_SEEDS 5 × phrasings 3 |
| out_of_scope | 15 | OUT_OF_SCOPE_SEEDS 5 × phrasings 3 |

합계 200. 검증: `uv run python -c "from collections import Counter; import json; print(dict(Counter(json.loads(l)['category'] for l in open('backend/scripts/data/baseline_questions.jsonl'))))"`.

재현 가능 generator: `backend/scripts/data/baseline_generate.py`. 수동 편집 후 재실행 금지.

## 3. 수집 스크립트 설계

- `POST /chat` 동기 호출 (현재 인증 없음, rate_limit 만) — SSE 복잡도 회피
- 기본 1 req/s, `--rate-per-sec` 로 조정
- 결과: `{id, query, category, status_code, answer, citations_count, session_id, latency_ms, error}` JSONL
- `--limit N` 으로 상위 N건 smoke
- 실패(non-200) 건수 기록, exit code 0 (전체 성공) / 2 (부분 실패)

## 4. 테스트

단위 11건 PASS:
- 카탈로그 로더 4(exists/parse/unique-id/unique-query)
- 200건 검증 2(count/balance)
- Chat API mock 2(success/failure)
- argparse 3(execute requires api-base / dry-run defaults / execute full)

실행: `cd backend && uv run pytest tests/scripts/test_quality_baseline_collect.py -v` → 11 passed.

Dry-run smoke: `uv run python scripts/quality_baseline_collect.py --dry-run` → `[dry-run] 카탈로그 200 건 검증 완료. --execute --api-base <URL> 로 실행.`

## 5. staging 이후 실행

```bash
uv run python scripts/quality_baseline_collect.py \
    --execute \
    --api-base https://truewords-backend-staging-*.run.app \
    --rate-per-sec 1.0
```

`reports/baseline_<ts>.jsonl` 생성 → R2 착수 전 현 파이프라인의 baseline 확정. R2 완료 후 동일 명령으로 after 측정.

## 6. 후속

- LLM judge (§19.12) 는 별도 스크립트로 분리. 본 JSONL 을 입력으로 pairwise 비교.
- 200건은 시작점. 운영 analytics `search_events` 에서 실 쿼리 50건 수동 curation 으로 보강 후보 (staging 진입 후 결정).
