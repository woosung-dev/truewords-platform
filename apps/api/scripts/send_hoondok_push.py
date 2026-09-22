"""훈독 Web Push 발송 — VM cron 15분 간격 (PLAN-HD-006 §2-6).

발송 로직은 `app/modules/hoondok/push_sender.py` 에 있고 이 파일은 얇은 진입점이다.

  cron:  */15 * * * * /home/ubuntu/truewords/send-hoondok-push.sh >> ~/truewords-cron.log 2>&1
  운영:  docker compose --env-file .env exec -T backend python scripts/send_hoondok_push.py --execute
  증거:  ... python scripts/send_hoondok_push.py --to-email me@example.com --execute

VAPID 3값이 없으면 아무것도 하지 않고 {"mode":"disabled",...} 를 찍은 뒤 정상 종료한다 —
cron 을 먼저 등록해도 무해하다.

종료 코드:
  0  정상 (개별 구독 실패는 요약의 failed 로만 보고한다)
  1  치명적 오류 (DB 연결 실패 등)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

# scripts/ 에서 app/* import 가능하도록 apps/api/ 를 sys.path 에 추가
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.modules.hoondok.push_sender import run_push_sender  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="대상 선정만 한다 (기본, 발송 0)")
    mode.add_argument("--execute", action="store_true", help="실제 발송")
    parser.add_argument(
        "--to-email",
        type=str,
        default=None,
        help="이 계정의 모든 구독에 창·완료 조건을 무시하고 즉시 1회 발송 (실기기 증거용)",
    )
    args = parser.parse_args(argv)

    try:
        summary = await run_push_sender(execute=args.execute, to_email=args.to_email)
    except Exception:
        logger.exception("훈독 push 발송 실패")
        return 1
    print(json.dumps(summary.as_dict(), ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main(argv))


if __name__ == "__main__":
    sys.exit(main())
