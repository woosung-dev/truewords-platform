"""audit 2차 S5 (2026-05-15) — boundary import 회귀 잠금.

본 test 는 source 단에서 import 회귀를 catch — module-level import 가 cross-domain
또는 deprecated shim 으로 되돌아가지 않도록.

대상:
- B-1: chat/dependencies + chat/service 가 pipeline.ingestion_repository 직접 import X
- B-3: ingest_service 가 ingest_worker 의 get_main_loop import X (역의존 제거)
- B-6: src/qdrant_client.py shim 영구 제거 확인 (cleanup Sub-PR B)
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

# apps/api/src 경로 — worktree 또는 main 위치 어느쪽에서도 동작하도록 module file 기준 해석
_SRC = Path(__file__).resolve().parent.parent / "app" / "modules"


def _read_module(rel_path: str) -> str:
    return (_SRC / rel_path).read_text(encoding="utf-8")


def test_chat_dependencies_uses_facade_for_ingestion_repo() -> None:
    """audit 2차 B-1: chat/dependencies 가 facade 만 import — pipeline 직접 X."""
    src = _read_module("chat/dependencies.py")
    assert "from app.modules.pipeline.facade import" in src, (
        "audit 2차 B-1 — chat/dependencies 는 facade 경유해야 함"
    )
    assert "from app.modules.pipeline.ingestion_repository import" not in src, (
        "audit 2차 B-1 — chat 도메인의 pipeline 직접 import 회귀"
    )


def test_facade_re_exports_repo_and_factory() -> None:
    """audit 2차 B-1: facade 가 IngestionJobRepository + make_ingestion_repo 노출."""
    from app.modules.pipeline.facade import (  # noqa: F401
        IngestionJobRepository,
        make_ingestion_repo,
    )


def test_ingest_service_uses_common_event_loop() -> None:
    """audit 2차 B-3: ingest_service 가 common.event_loop 사용 — worker 역의존 제거."""
    src = _read_module("admin/ingest_service.py")
    assert "from app.core.common.event_loop import get_main_loop" in src, (
        "audit 2차 B-3 — ingest_service 는 common.event_loop 경유해야 함"
    )
    # 회귀: worker 의 get_main_loop 직접 import 가 다시 추가됐는지
    bad_pattern = re.compile(r"from\s+app\.modules\.admin\.ingest_worker\s+import\s+[^\n]*get_main_loop")
    assert not bad_pattern.search(src), (
        "audit 2차 B-3 — service → worker 역의존 회귀"
    )


def test_common_event_loop_module_exists() -> None:
    """audit 2차 B-3: common.event_loop 모듈 존재 + set/get_main_loop 노출."""
    from app.core.common.event_loop import get_main_loop, set_main_loop  # noqa: F401


def test_deprecated_qdrant_client_shim_removed() -> None:
    """cleanup Sub-PR B: src/qdrant_client.py shim 영구 제거 확인 (audit 2차 B-6 후속)."""
    shim_path = _SRC / "qdrant_client.py"
    assert not shim_path.exists(), (
        "src/qdrant_client.py shim 은 제거되었다. 신규 코드는 `from app.modules.qdrant import ...` 사용."
    )


# ── 패키지 간 의존 방향 ratchet ──────────────────────────────────────────────
# app/**/*.py 의 모든 import(함수 안 지연 import 포함)를 ast 로 읽어
# `core` / `modules.<이름>` 사이 간선을 모은다. 허용 집합은 현재 코드의 스냅숏이다.
# 새 간선은 추가하지 말고, 사라진 간선은 여기서 지운다.

_APP = Path(__file__).resolve().parent.parent / "app"

_ALLOWED_CORE_TO_MODULES = {
    ("core", "modules.admin"),
    ("core", "modules.chat"),
    ("core", "modules.chatbot"),
    ("core", "modules.datasource"),
    ("core", "modules.hoondok"),
    ("core", "modules.identity"),
    ("core", "modules.pipeline"),
    ("core", "modules.safety"),
    ("core", "modules.search"),
}

_ALLOWED_MODULES_TO_MODULES = {
    ("modules.admin", "modules.chat"),
    ("modules.admin", "modules.datasource"),
    ("modules.admin", "modules.pipeline"),
    ("modules.admin", "modules.qdrant"),
    ("modules.admin", "modules.safety"),
    ("modules.chat", "modules.admin"),
    ("modules.chat", "modules.cache"),
    ("modules.chat", "modules.chatbot"),
    ("modules.chat", "modules.malssum"),
    ("modules.chat", "modules.pipeline"),
    ("modules.chat", "modules.qdrant"),
    ("modules.chat", "modules.safety"),
    ("modules.chat", "modules.search"),
    ("modules.chatbot", "modules.admin"),
    ("modules.chatbot", "modules.chat"),
    ("modules.chatbot", "modules.qdrant"),
    ("modules.datasource", "modules.admin"),
    ("modules.datasource", "modules.chatbot"),
    ("modules.datasource", "modules.qdrant"),
    ("modules.hoondok", "modules.admin"),
    ("modules.hoondok", "modules.chat"),
    ("modules.hoondok", "modules.chatbot"),
    ("modules.hoondok", "modules.datasource"),
    ("modules.hoondok", "modules.identity"),
    ("modules.hoondok", "modules.pipeline"),
    ("modules.hoondok", "modules.qdrant"),
    ("modules.hoondok", "modules.safety"),
    ("modules.hoondok", "modules.search"),
    ("modules.identity", "modules.admin"),
    ("modules.identity", "modules.hoondok"),
    ("modules.identity", "modules.safety"),
    ("modules.search", "modules.chat"),
    ("modules.search", "modules.pipeline"),
    ("modules.search", "modules.qdrant"),
}


def _package_node(dotted: str) -> str | None:
    """`app.core...` → "core", `app.modules.<이름>...` → "modules.<이름>", 그 밖은 None."""
    parts = dotted.split(".")
    if parts[:2] == ["app", "core"]:
        return "core"
    if parts[:2] == ["app", "modules"] and len(parts) >= 3:
        return f"modules.{parts[2]}"
    return None


def _collect_edges() -> dict[tuple[str, str], set[str]]:
    """(출발, 도착) 간선 → 그 간선을 만든 파일 경로들."""
    edges: dict[tuple[str, str], set[str]] = {}
    for path in sorted(_APP.rglob("*.py")):
        rel = path.relative_to(_APP.parent)
        source = _package_node(".".join(rel.with_suffix("").parts))
        if source is None:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                # `from app.modules import chat` 처럼 이름 쪽이 패키지인 경우도 잡도록 이름까지 붙인다
                targets = [f"{node.module}.{alias.name}" for alias in node.names]
            else:
                continue
            for target in targets:
                dest = _package_node(target)
                if dest is not None and dest != source:
                    edges.setdefault((source, dest), set()).add(str(rel))
    return edges


def _new_edges_message(
    edges: dict[tuple[str, str], set[str]], allowed: set[tuple[str, str]]
) -> str:
    lines = [
        f"{src} → {dst}: {', '.join(sorted(edges[(src, dst)]))}"
        for src, dst in sorted(set(edges) - allowed)
    ]
    return "허용되지 않은 의존 간선이 생겼다:\n" + "\n".join(lines)


def test_core_to_modules_edges_do_not_grow() -> None:
    edges = {e: files for e, files in _collect_edges().items() if e[0] == "core"}
    assert set(edges) <= _ALLOWED_CORE_TO_MODULES, _new_edges_message(
        edges, _ALLOWED_CORE_TO_MODULES
    )


def test_modules_to_modules_edges_do_not_grow() -> None:
    edges = {
        e: files
        for e, files in _collect_edges().items()
        if e[0].startswith("modules.") and e[1].startswith("modules.")
    }
    assert set(edges) <= _ALLOWED_MODULES_TO_MODULES, _new_edges_message(
        edges, _ALLOWED_MODULES_TO_MODULES
    )
