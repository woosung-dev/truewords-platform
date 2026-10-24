"""원문·낭독·발췌가 같은 청크를 같은 글로 표시하는 계약."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.modules.hoondok.models import ContentRight
from app.modules.hoondok.reading_content import ReaderContent


def reader():
    overlap = (
        "겹치는 문장이 여기 있습니다. 앞 청크의 끝과 이 청크의 시작이 같은 글입니다."
    )
    texts = {
        20: "페이지 첫 문장입니다. " + overlap,
        21: overlap + " 새로운 문장입니다." * 10,
    }
    points = {
        index: SimpleNamespace(
            id=index,
            score=0.0,
            payload={"volume": "v", "chunk_index": index, "text": text},
        )
        for index, text in texts.items()
    }

    async def scroll(_collection, *, scroll_filter, **_):
        condition = scroll_filter["must"][1]
        if "range" in condition:
            return list(points.values()), None
        return [points[index] for index in condition["match"]["any"]], None

    client = AsyncMock()
    client.count.return_value = 22
    client.scroll.side_effect = scroll
    client.retrieve.side_effect = lambda _collection, *, ids: [
        points[index] for index in ids if index in points
    ]
    repo = SimpleNamespace(
        list_rights=AsyncMock(
            return_value=[
                ContentRight(
                    volume="v",
                    work_title="원문",
                    status="allowed",
                    scope_full_text=True,
                )
            ]
        )
    )
    return ReaderContent(repo, client), repo


@pytest.mark.asyncio
async def test_page_audio_and_legacy_excerpt_share_text():
    content, _ = reader()
    page = await content.words("v", 2, None)
    excerpts = await content.excerpt_texts([("v", "20"), ("v", "21")])
    for chunk in page.chunks:
        assert chunk.display_text == await content.chunk_display_text(chunk.chunk_id)
        assert chunk.display_text == excerpts[("v", chunk.chunk_id)]
    assert page.chunks[1].display_text.startswith("새로운 문장입니다.")
    assert "겹치는" not in page.chunks[1].display_text


@pytest.mark.asyncio
async def test_rights_withdrawn_during_read_are_not_returned():
    content, repo = reader()
    repo.list_rights.side_effect = [repo.list_rights.return_value, []]
    with pytest.raises(HTTPException) as caught:
        await content.words("v", 2, None)
    assert caught.value.status_code == 404
