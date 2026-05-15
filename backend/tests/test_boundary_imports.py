"""audit 2차 S5 (2026-05-15) — boundary import 회귀 잠금.

본 test 는 source 단에서 import 회귀를 catch — module-level import 가 cross-domain
또는 deprecated shim 으로 되돌아가지 않도록.

대상:
- B-1: chat/dependencies + chat/service 가 pipeline.ingestion_repository 직접 import X
- B-3: ingest_service 가 ingest_worker 의 get_main_loop import X (역의존 제거)
- B-6: src/* 가 src.qdrant_client deprecated shim import X (src.qdrant 직접 사용)
"""

from __future__ import annotations

import re
from pathlib import Path

# backend/src 경로 — worktree 또는 main 위치 어느쪽에서도 동작하도록 module file 기준 해석
_SRC = Path(__file__).resolve().parent.parent / "src"


def _read_module(rel_path: str) -> str:
    return (_SRC / rel_path).read_text(encoding="utf-8")


def test_chat_dependencies_uses_facade_for_ingestion_repo() -> None:
    """audit 2차 B-1: chat/dependencies 가 facade 만 import — pipeline 직접 X."""
    src = _read_module("chat/dependencies.py")
    assert "from src.common.ingestion_facade import" in src, (
        "audit 2차 B-1 — chat/dependencies 는 facade 경유해야 함"
    )
    assert "from src.pipeline.ingestion_repository import" not in src, (
        "audit 2차 B-1 — chat 도메인의 pipeline 직접 import 회귀"
    )


def test_facade_re_exports_repo_and_factory() -> None:
    """audit 2차 B-1: facade 가 IngestionJobRepository + make_ingestion_repo 노출."""
    from src.common.ingestion_facade import (  # noqa: F401
        IngestionJobRepository,
        make_ingestion_repo,
    )


def test_ingest_service_uses_common_event_loop() -> None:
    """audit 2차 B-3: ingest_service 가 common.event_loop 사용 — worker 역의존 제거."""
    src = _read_module("admin/ingest_service.py")
    assert "from src.common.event_loop import get_main_loop" in src, (
        "audit 2차 B-3 — ingest_service 는 common.event_loop 경유해야 함"
    )
    # 회귀: worker 의 get_main_loop 직접 import 가 다시 추가됐는지
    bad_pattern = re.compile(r"from\s+src\.admin\.ingest_worker\s+import\s+[^\n]*get_main_loop")
    assert not bad_pattern.search(src), (
        "audit 2차 B-3 — service → worker 역의존 회귀"
    )


def test_common_event_loop_module_exists() -> None:
    """audit 2차 B-3: common.event_loop 모듈 존재 + set/get_main_loop 노출."""
    from src.common.event_loop import get_main_loop, set_main_loop  # noqa: F401


def test_src_does_not_import_deprecated_qdrant_client_shim() -> None:
    """audit 2차 B-6: src/* 가 src.qdrant_client deprecated shim 직접 import 0건.

    shim 파일 (`src/qdrant_client.py`) 본문은 검사 제외. 신규 코드는 ``src.qdrant``
    패키지 import 만 허용. backend/scripts + tests 는 shim 호환 허용 (운영 미영향).
    """
    bad_pattern = re.compile(r"^\s*from\s+src\.qdrant_client\s+import", re.MULTILINE)
    offenders: list[str] = []
    for py in _SRC.rglob("*.py"):
        if py.name == "qdrant_client.py":
            continue  # shim 자체는 검사 제외
        text = py.read_text(encoding="utf-8")
        if bad_pattern.search(text):
            offenders.append(str(py.relative_to(_SRC)))
    assert not offenders, (
        f"audit 2차 B-6 — src/* 가 deprecated shim 사용: {offenders}. "
        f"`from src.qdrant import get_raw_client` 으로 교체 필요."
    )
