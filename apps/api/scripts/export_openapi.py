"""FastAPI 계약을 외부 접속·lifespan·개인 .env 없이 결정적으로 내보낸다."""

from __future__ import annotations

import argparse
from contextlib import chdir
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch


API_ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = API_ROOT.parent.parent / "contracts" / "openapi.json"


def render_schema() -> str:
    # 스키마 생성에 런타임 자격 증명이 필요하지 않다. 빈 cwd는 Settings의
    # .env 자동 로드를 막고, 환경 격리는 개발자의 운영 설정 유입을 막는다.
    sys.path.insert(0, str(API_ROOT))
    with (
        TemporaryDirectory(prefix="truewords-openapi-") as temporary_directory,
        chdir(temporary_directory),
        patch.dict(os.environ, {"GEMINI_API_KEY": "openapi-export-only"}, clear=True),
        patch("socket.socket.connect", side_effect=RuntimeError("OpenAPI export forbids network access")),
        patch("socket.socket.connect_ex", side_effect=RuntimeError("OpenAPI export forbids network access")),
    ):
        from app.main import app

        schema = app.openapi()

    operations = [
        operation["operationId"]
        for path in schema["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict) and "operationId" in operation
    ]
    if len(operations) != len(set(operations)):
        raise ValueError("OpenAPI operationId must be unique")
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=CONTRACT_PATH)
    parser.add_argument("--check", action="store_true", help="생성 결과와 기존 계약의 일치 검사")
    args = parser.parse_args()
    output = args.output.resolve()
    rendered = render_schema()
    if args.check:
        if not output.exists() or output.read_text(encoding="utf-8") != rendered:
            print(f"Contract drift: regenerate {output}", file=sys.stderr)
            return 1
        print(f"Contract matches: {output}")
        return 0
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")
    print(f"Exported: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
