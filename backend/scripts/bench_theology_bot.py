"""신학/원리 전문 봇을 cascading + weighted 두 모드로 실행해 CSV 비교.

사용법:
    cd backend
    PYTHONPATH=. uv run python scripts/bench_theology_bot.py \\
        "/Users/woosung/Downloads/AI 학습용 Q&A 데이터셋 30선 - AI 학습용 Q&A 데이터셋 30선.csv" \\
        --category 참부모신학

동작:
    1. CSV 읽기 → 지정 카테고리(기본: 참부모신학) 행만 필터
    2. DB에서 신학/원리 전문 봇 search_tiers 원본 백업
    3. search_mode=cascading 으로 플립 → 각 질문 /chat 호출
    4. search_mode=weighted 로 플립 → 각 질문 /chat 호출
    5. 원본 복원
    6. 원본 CSV에 4컬럼 추가하여 저장
       (Cascading 답변 / 참고 데이터 / Weighted 답변 / 참고 데이터)

주의:
    - 백엔드가 localhost:8000에서 실행 중이어야 함
    - rate limit (20 req/60s) 보호를 위해 3.2초 간격
    - 중단되면 `--restore-mode <원본>`으로 수동 복원 권장
"""

import argparse
import asyncio
import csv
import sys
import time
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.chatbot.models import ChatbotConfig
from src.common.database import async_session_factory

CHATBOT_ID = "신학/원리 전문 봇"
API_URL = "http://localhost:8000/chat"
RATE_LIMIT_SLEEP = 3.2  # 20 req/60s 방어


async def get_search_tiers() -> dict:
    async with async_session_factory() as session:
        stmt = select(ChatbotConfig).where(ChatbotConfig.chatbot_id == CHATBOT_ID)
        config = (await session.execute(stmt)).scalar_one_or_none()
        if config is None:
            raise RuntimeError(f"챗봇 '{CHATBOT_ID}' 없음")
        return dict(config.search_tiers)


async def set_search_mode(mode: str) -> None:
    async with async_session_factory() as session:
        stmt = select(ChatbotConfig).where(ChatbotConfig.chatbot_id == CHATBOT_ID)
        config = (await session.execute(stmt)).scalar_one()
        new_tiers = dict(config.search_tiers)
        new_tiers["search_mode"] = mode
        config.search_tiers = new_tiers
        flag_modified(config, "search_tiers")
        session.add(config)
        await session.commit()


def call_chat(question: str, client: httpx.Client) -> dict:
    try:
        r = client.post(
            API_URL,
            json={"query": question, "chatbot_id": CHATBOT_ID},
            timeout=180,
        )
        r.raise_for_status()
        data = r.json()
        return {
            "answer": data.get("answer", ""),
            "sources": data.get("sources", []),
        }
    except Exception as e:
        return {"answer": f"[오류] {e}", "sources": []}


def format_sources(sources: list) -> str:
    if not sources:
        return ""
    lines = []
    for i, s in enumerate(sources[:10], 1):
        vol = s.get("volume", "")
        score = s.get("score", 0)
        text_preview = (s.get("text", "") or "").replace("\n", " ")[:80]
        lines.append(f"{i}. {vol} (score={score:.3f}) {text_preview}")
    return "\n".join(lines)


def run_mode(target_rows: list[dict], query_field: str, mode: str) -> list[dict]:
    print(f"\n=== {mode} 모드 — {len(target_rows)}개 질문 ===")
    results = []
    with httpx.Client() as client:
        for i, row in enumerate(target_rows, 1):
            q = row.get(query_field, "")
            print(f"[{i}/{len(target_rows)}] {q[:50]}")
            res = call_chat(q, client)
            preview = res["answer"][:80].replace("\n", " ")
            print(f"  → {preview}...")
            results.append(res)
            time.sleep(RATE_LIMIT_SLEEP)
    return results


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path")
    parser.add_argument("--category", default="참부모신학")
    parser.add_argument("--output", default=None)
    parser.add_argument(
        "--restore-mode",
        default=None,
        help="이전 중단된 실행 복구용: search_mode만 이 값으로 되돌리고 종료",
    )
    args = parser.parse_args()

    if args.restore_mode:
        await set_search_mode(args.restore_mode)
        print(f"복원 완료: search_mode={args.restore_mode}")
        return

    csv_path = Path(args.csv_path)
    default_output = csv_path.parent / (csv_path.stem + "_비교.csv")
    output_path = Path(args.output) if args.output else default_output

    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    query_field = "질문 (User Query)"
    if query_field not in fieldnames:
        raise SystemExit(f"CSV에 '{query_field}' 컬럼이 없습니다. 헤더: {fieldnames}")

    filtered_indices = [
        i for i, r in enumerate(rows)
        if r.get("카테고리", "").strip() == args.category
    ]
    filtered_rows = [rows[i] for i in filtered_indices]
    print(f"전체 {len(rows)}행 중 '{args.category}' {len(filtered_rows)}행")
    if not filtered_rows:
        raise SystemExit("대상 행 없음")

    original = await get_search_tiers()
    original_mode = original.get("search_mode", "cascading")
    print(f"원본 search_mode: {original_mode}")

    try:
        await set_search_mode("cascading")
        cascading_results = run_mode(filtered_rows, query_field, "cascading")

        await set_search_mode("weighted")
        weighted_results = run_mode(filtered_rows, query_field, "weighted")
    finally:
        await set_search_mode(original_mode)
        print(f"\n복원 완료 → search_mode={original_mode}")

    new_fields = list(fieldnames) + [
        "Cascading 답변",
        "Cascading 참고 데이터",
        "Weighted 답변",
        "Weighted 참고 데이터",
    ]

    for j, idx in enumerate(filtered_indices):
        cas = cascading_results[j]
        wei = weighted_results[j]
        rows[idx]["Cascading 답변"] = cas["answer"]
        rows[idx]["Cascading 참고 데이터"] = format_sources(cas["sources"])
        rows[idx]["Weighted 답변"] = wei["answer"]
        rows[idx]["Weighted 참고 데이터"] = format_sources(wei["sources"])

    for i, row in enumerate(rows):
        for col in ("Cascading 답변", "Cascading 참고 데이터",
                    "Weighted 답변", "Weighted 참고 데이터"):
            row.setdefault(col, "")

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=new_fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n저장 완료: {output_path}")
    print(f"추가 컬럼: {new_fields[-4:]}")


if __name__ == "__main__":
    asyncio.run(main())
