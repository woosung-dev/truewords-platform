"""
사용법: uv run python scripts/ingest.py ../data/sample/
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import settings
from src.qdrant_client import get_client
from src.pipeline.chunker import chunk_text
from src.pipeline.ingestor import ingest_chunks


def main(data_dir: str) -> None:
    client = get_client()
    txt_files = sorted(Path(data_dir).glob("*.txt"))

    if not txt_files:
        print(f"오류: {data_dir} 에 .txt 파일이 없습니다.")
        sys.exit(1)

    print(f"{len(txt_files)}개 파일 발견. 적재 시작...")

    for txt_file in txt_files:
        volume = txt_file.stem
        text = txt_file.read_text(encoding="utf-8")
        chunks = chunk_text(text, volume=volume, max_chars=500, overlap=50)
        ingest_chunks(client, settings.collection_name, chunks)
        print(f"  {volume}: {len(chunks)}개 청크 적재 완료")

    print("전체 적재 완료.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("사용법: python scripts/ingest.py <data_dir>")
        sys.exit(1)
    main(sys.argv[1])
