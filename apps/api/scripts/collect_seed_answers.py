"""RAGAS 시드의 50건 질문을 backend /chat 에 재호출해 answer/contexts 갱신.

Phase A 의 sample_eval_pairs.py 가 만든 시드 JSON 을 입력받아, 각 질문을
실시간 backend 로 보내 새 답변과 sources 를 받아 새 시드 JSON 으로 저장한다.

3-way RAGAS 측정 사이클:

    # (1) baseline RAGAS = Phase A 시드 그대로
    uv run --group eval python scripts/eval_ragas.py \\
        --seed ~/Downloads/ragas_eval_seed_50_<ts>.json \\
        --output ~/Downloads/ragas_baseline_<ts>.xlsx

    # (2) 액션 2 적용 (admin UI 에서 system_prompt 변경) + 백엔드 재시작
    #     IntentClassifier 강제 OFF 로 액션 1 효과 분리
    INTENT_CLASSIFIER_FORCE_OFF=1 (backend 재시작)
    uv run --group eval python scripts/collect_seed_answers.py \\
        --seed ~/Downloads/ragas_eval_seed_50_<ts>.json \\
        --output ~/Downloads/ragas_seed_action2_<ts>.json
    uv run --group eval python scripts/eval_ragas.py \\
        --seed ~/Downloads/ragas_seed_action2_<ts>.json \\
        --output ~/Downloads/ragas_action2_<ts>.xlsx

    # (3) 액션 1+2 (env 토글 해제 후 백엔드 재시작)
    (INTENT_CLASSIFIER_FORCE_OFF unset, backend 재시작)
    uv run --group eval python scripts/collect_seed_answers.py \\
        --seed ~/Downloads/ragas_eval_seed_50_<ts>.json \\
        --output ~/Downloads/ragas_seed_action1plus2_<ts>.json
    uv run --group eval python scripts/eval_ragas.py \\
        --seed ~/Downloads/ragas_seed_action1plus2_<ts>.json \\
        --output ~/Downloads/ragas_action1plus2_<ts>.xlsx

옵션:
    --rate-per-sec  분당 요청 한도 방어 (default 0.3 = 3.3s 간격)
    --chatbot-id    POST 시 사용할 chatbot_id (default "all")
    --api-base      backend URL (default http://localhost:8000)
    --limit N       앞에서부터 N건만 (디버깅)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx


def call_chat(
    client: httpx.Client,
    *,
    api_base: str,
    query: str,
    chatbot_id: str,
) -> tuple[str, list[dict], str]:
    """동기 /chat 호출. 실패 시 ('[오류] ...', [], '') 반환."""
    url = f"{api_base.rstrip('/')}/chat"
    try:
        r = client.post(
            url,
            json={"query": query, "chatbot_id": chatbot_id},
            timeout=180.0,
        )
    except Exception as e:
        return f"[오류] 네트워크: {e}", [], ""
    if r.status_code != 200:
        return f"[오류] HTTP {r.status_code}: {r.text[:300]}", [], ""
    d = r.json()
    return (
        d.get("answer", "") or "",
        list(d.get("sources", []) or []),
        str(d.get("session_id", "") or ""),
    )


def collect(
    seed_path: Path,
    *,
    api_base: str,
    chatbot_id: str,
    rate_per_sec: float,
    limit: int | None,
) -> list[dict]:
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    if limit:
        seed = seed[:limit]

    sleep_s = 1.0 / max(rate_per_sec, 0.01)
    failures = 0
    started = time.time()
    out: list[dict] = []
    with httpx.Client() as client:
        for i, item in enumerate(seed, 1):
            q = item.get("question", "")
            preview = (q or "").replace("\n", " ")[:60]
            print(f"[{i}/{len(seed)}] #{item.get('id')} | {preview}")
            answer, sources, session_id = call_chat(
                client, api_base=api_base, query=q, chatbot_id=chatbot_id
            )
            if answer.startswith("[오류]"):
                failures += 1
            # contexts: sources 의 text 만 추출 (최대 3개)
            contexts = [
                (s.get("text") or "").strip()
                for s in sources
                if (s.get("text") or "").strip()
            ][:3]
            new_item = dict(item)
            new_item["answer"] = answer
            new_item["contexts"] = contexts
            new_item["session_id"] = session_id
            out.append(new_item)
            ans_preview = (answer or "").replace("\n", " ")[:80]
            print(f"   → contexts={len(contexts)} | {ans_preview}")
            if i < len(seed):
                time.sleep(sleep_s)

    elapsed = time.time() - started
    print(f"\n완료: {len(out)}건 / 실패 {failures} / 소요 {elapsed:.1f}s")
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", type=Path, required=True, help="입력 시드 JSON")
    p.add_argument("--output", type=Path, required=True, help="새 시드 JSON 저장 경로")
    p.add_argument("--api-base", default="http://localhost:8000")
    p.add_argument("--chatbot-id", default="all")
    p.add_argument("--rate-per-sec", type=float, default=0.3)
    p.add_argument("--limit", type=int, default=None)
    args = p.parse_args()

    if not args.seed.exists():
        raise SystemExit(f"입력 시드 없음: {args.seed}")

    out = collect(
        args.seed,
        api_base=args.api_base,
        chatbot_id=args.chatbot_id,
        rate_per_sec=args.rate_per_sec,
        limit=args.limit,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n→ {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
