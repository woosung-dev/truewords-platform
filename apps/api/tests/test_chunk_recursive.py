"""운영 업로드 경로 청킹(chunk_recursive)이 런타임 의존성만으로 동작하는지 확인한다.

langchain_text_splitters 가 평가용 group 에만 있어 운영 이미지(--no-dev)에서
ImportError 가 나던 결함의 재현 테스트.
"""

from app.modules.pipeline.chunker import chunk_recursive


def test_chunk_recursive_runs_without_mocks():
    text = "하나님은 사랑이시다. 참부모님은 인류의 참된 부모이시다.\n\n" * 40
    chunks = chunk_recursive(text, volume="vol_001")
    assert len(chunks) > 1
    assert all(chunk.text.strip() for chunk in chunks)
