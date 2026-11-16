"""scripts/*.py 가 쓰는 app.* import 가 아직 살아 있는지 검사한다.

스크립트는 어떤 테스트도 import 하지 않아서 app 쪽 이름이 바뀌면 CI 가 못 잡는다.
스크립트를 실행하지 않고 ast 로 import 문만 읽은 뒤, 대상 모듈을 import 해 이름이 있는지 본다.
"""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"

# 운영 VM cron 이 파일 이름으로 호출한다. 이름을 바꾸면 운영 점검이 다음 날에야 실패한다.
_CRON_SCRIPTS = (
    "refresh_suggested_questions.py",
    "send_hoondok_push.py",
    "cleanup_semantic_cache.py",
    "gemini_key_probe.py",
)


def _app_imports(path: Path) -> list[tuple[str, str | None]]:
    """(모듈, 이름) 목록. `import app.x` 는 이름이 None. 함수 안 지연 import 도 포함한다."""
    found: list[tuple[str, str | None]] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found += [(a.name, None) for a in node.names if a.name.split(".")[0] == "app"]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] == "app":
                found += [(node.module, a.name) for a in node.names if a.name != "*"]
    return found


def test_cron_scripts_exist() -> None:
    missing = [name for name in _CRON_SCRIPTS if not (_SCRIPTS / name).is_file()]
    assert not missing, f"cron 이 호출하는 스크립트가 없다: {missing}"


@pytest.mark.parametrize("script", sorted(_SCRIPTS.glob("*.py")), ids=lambda p: p.name)
def test_script_app_imports_resolve(script: Path) -> None:
    broken: list[str] = []
    for module_name, name in _app_imports(script):
        try:
            module = importlib.import_module(module_name)
        except ImportError as exc:
            broken.append(f"import {module_name}: {exc}")
            continue
        if name is None or hasattr(module, name):
            continue
        # `from app.modules import qdrant` 처럼 아직 import 되지 않은 하위 모듈일 수 있다
        try:
            importlib.import_module(f"{module_name}.{name}")
        except ImportError:
            broken.append(f"from {module_name} import {name}")
    assert not broken, f"{script.name} 의 app import 가 깨졌다:\n" + "\n".join(broken)
