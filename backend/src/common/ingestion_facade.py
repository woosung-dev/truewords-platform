# Cross-domain ingestion facade — chat 도메인이 ingestion 도메인의 내부 표현에 의존하지 않도록 thin wrapper.
"""IngestionFacade — chat 도메인이 ingestion 도메인 detail 에 직접 의존하지 않게 묶는 thin 모듈.

audit P1-9 fix (2026-05-15): `chat/service.py` 가 `IngestionJobRepository` /
`pipeline/metadata.derive_volume` 같은 ingestion 내부 구현체를 직접 import 했다.
chat 응답이 필요로 하는 것은 (a) corpus 의 최신 갱신 시각 (cache invalidation
트리거) 와 (b) volume_key → display_name lookup 두 가지 뿐. 둘만 추출한 facade
가 chat 의 cross-domain 의존을 thin 으로 좁힌다.

본 모듈 자체는 `IngestionJobRepository` 와 `derive_volume` 을 의존하지만, 그
지식은 facade 안에 격리된다 — chat 도메인은 이 함수 두 개만 import 한다.
"""

from __future__ import annotations

from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.metadata import derive_volume


async def get_corpus_updated_at(repo: IngestionJobRepository) -> float:
    """현재 corpus 의 max(completed_at) Unix timestamp. 실패 시 0.0 (graceful)."""
    try:
        return await repo.get_max_completed_at()
    except Exception:
        return 0.0


async def build_display_name_lookup(
    repo: IngestionJobRepository,
) -> dict[tuple[str, str], str]:
    """(source, volume) → display_name 매핑. admin 인라인 편집 결과 활용용.

    chunk payload.volume = ``derive_volume(IngestionJob.volume_key)`` 로 동일 매핑.
    repo 조회 실패는 빈 dict 로 graceful (chat UI 가 기존 volume/source fallback).
    """
    try:
        jobs = await repo.list_all()
    except Exception:
        return {}
    return {
        (job.source, derive_volume(job.volume_key)): job.display_name
        for job in jobs
        if job.display_name
    }
