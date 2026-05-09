"""봇별 추천 질문 칩 cron 갱신 — 매일 03:30 KST.

흐름:
  활성 챗봇 (is_active=True) 모두 순회
    → SuggestedQuestionsService.generate_for_bot()
    → 30 일 사용자 질문 + RAG sample 로 Gemini 호출
    → chatbot_configs.suggested_questions JSONB 저장 + suggested_at 타임스탬프

cleanup_semantic_cache.py 와 동일한 인프라 무관 패턴:
  EC2 cron      30 3 * * * cd /path/backend && uv run python scripts/refresh_suggested_questions.py --execute
  k8s CronJob   spec.schedule: "30 3 * * *"
  Cloud Scheduler / Cloud Run job 어디서든 동일하게 동작

봇별 실패는 격리 — 한 봇 실패해도 다음 봇 진행. 마지막에 summary 출력.

종료 코드:
  0  성공 (모든 봇 또는 일부 봇 처리 — failed 도 정상 종료, 실패 정보는 stdout)
  1  치명적 오류 (DB 연결 실패 등)

사용:
  uv run python scripts/refresh_suggested_questions.py --execute
  uv run python scripts/refresh_suggested_questions.py --bot-id main_bot --execute
  uv run python scripts/refresh_suggested_questions.py --dry-run

상세 ADR: docs/dev-log/2026-05-10-dynamic-suggested-questions.md
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

# scripts/ 에서 src/* import 가능하도록 backend/ 를 sys.path 에 추가
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.chatbot.repository import ChatbotRepository  # noqa: E402
from src.chatbot.suggested_service import SuggestedQuestionsService  # noqa: E402
from src.common.database import async_session_factory  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _run_one(bot_id: str, days: int) -> int:
    async with async_session_factory() as session:
        repo = ChatbotRepository(session)
        service = SuggestedQuestionsService(repo)
        try:
            questions = await service.generate_for_bot(bot_id, days=days)
        except Exception:
            logger.exception("[fail] bot=%s", bot_id)
            return 1
        print(json.dumps({"chatbot_id": bot_id, "questions": questions}, ensure_ascii=False))
        return 0


async def _run_all(days: int, dry_run: bool) -> int:
    async with async_session_factory() as session:
        repo = ChatbotRepository(session)
        if dry_run:
            bots = await repo.list_active()
            print(
                json.dumps(
                    {
                        "dry_run": True,
                        "active_bots": [b.chatbot_id for b in bots],
                        "days": days,
                    },
                    ensure_ascii=False,
                )
            )
            return 0
        service = SuggestedQuestionsService(repo)
        summary = await service.generate_for_active_bots(days=days)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0


async def _main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="활성 봇 목록만 출력 (호출 0)")
    mode.add_argument("--execute", action="store_true", help="실제 실행")
    parser.add_argument(
        "--bot-id",
        type=str,
        default=None,
        help="단일 봇만 처리 (기본: 모든 활성 봇)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="질문 로그 분석 윈도우 (기본 30 일)",
    )
    args = parser.parse_args()

    if args.bot_id and args.dry_run:
        print(f"[dry-run] bot={args.bot_id} days={args.days}")
        return 0
    if args.bot_id:
        return await _run_one(args.bot_id, days=args.days)
    return await _run_all(days=args.days, dry_run=args.dry_run)


def main() -> int:
    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())
