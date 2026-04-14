"""
통합 적재 스크립트. 멀티포맷(TXT/PDF/DOCX) + 증분 적재 + source 분류 + 리포트.

사용법:
  cd backend
  PYTHONPATH=. uv run python scripts/ingest.py <data_dir> [--resume] [--report-dir reports/]

예시:
  # 전체 적재 (처음부터)
  PYTHONPATH=. uv run python scripts/ingest.py "/path/to/data"

  # 증분 적재 (COMPLETED 상태는 스킵)
  PYTHONPATH=. uv run python scripts/ingest.py "/path/to/data" --resume

지원 형식: .txt, .pdf, .docx
HWP 파일은 스킵됩니다 (TXT로 변환 후 제공 필요).

상태 추적은 PostgreSQL `ingestion_jobs` 테이블을 사용합니다.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from qdrant_client.models import FieldCondition, Filter, MatchValue

from src.common.database import async_session_factory
from src.config import settings
from src.pipeline.chunker import chunk_text
from src.pipeline.extractor import extract_text
from src.pipeline.ingestion_models import IngestionStatus
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import classify_source, extract_metadata
from src.pipeline.reporter import BatchReporter
from src.qdrant_client import get_client

SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx"}
SKIPPED_EXTENSIONS = {".hwp", ".hwpx"}


def find_files(data_dir: Path) -> list[Path]:
    """지원되는 파일을 재귀적으로 탐색."""
    files = []
    skipped_hwp = 0
    for f in sorted(data_dir.rglob("*")):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(f)
        elif f.is_file() and f.suffix.lower() in SKIPPED_EXTENSIONS:
            skipped_hwp += 1
    if skipped_hwp > 0:
        print(f"⚠️  HWP 파일 {skipped_hwp}개 스킵됨 (TXT로 변환 후 다시 실행하세요)")
    return files


def run_repo(fn):
    """짧은 트랜잭션으로 IngestionJobRepository 작업 실행."""
    async def _exec():
        async with async_session_factory() as session:
            repo = IngestionJobRepository(session)
            result = await fn(repo)
            await repo.commit()
            return result
    return asyncio.run(_exec())


def main() -> None:
    parser = argparse.ArgumentParser(description="말씀 데이터 적재 파이프라인")
    parser.add_argument("data_dir", help="데이터 디렉토리 경로")
    parser.add_argument("--resume", action="store_true", help="COMPLETED 상태 파일 스킵")
    parser.add_argument("--report-dir", default="reports/", help="리포트 출력 디렉토리")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"오류: 디렉토리가 존재하지 않습니다: {data_dir}")
        sys.exit(1)

    files = find_files(data_dir)
    if not files:
        print(f"오류: {data_dir}에 지원되는 파일(.txt, .pdf, .docx)이 없습니다.")
        sys.exit(1)

    print(f"📁 {len(files)}개 파일 발견")

    client = get_client()
    reporter = BatchReporter()

    if args.resume:
        jobs = run_repo(lambda r: r.list_all())
        completed_keys = {j.volume_key for j in jobs if j.status == IngestionStatus.COMPLETED}
        failed_count = sum(1 for j in jobs if j.status == IngestionStatus.FAILED)
        print(f"📊 이전 진행: {len(completed_keys)}개 완료, {failed_count}개 실패")
    else:
        completed_keys = set()

    total = len(files)
    for idx, filepath in enumerate(files, 1):
        volume_key = str(filepath.relative_to(data_dir))

        if args.resume and volume_key in completed_keys:
            continue

        print(f"\n[{idx}/{total}] {filepath.name}")

        try:
            run_repo(lambda r, v=volume_key, fn=filepath.name:
                     r.upsert_pending(v, fn, ""))

            text = extract_text(filepath)
            if not text.strip():
                print("  ⚠️  빈 파일, 스킵")
                run_repo(lambda r, v=volume_key: r.fail_job(v, "빈 파일"))
                reporter.add_error(volume_key, "빈 파일")
                continue

            meta = extract_metadata(filepath, text)
            source = classify_source(filepath)
            volume = meta["volume"] or volume_key

            chunks = chunk_text(
                text, volume=volume, max_chars=500, source=source,
                title=meta["title"], date=meta["date"],
            )
            print(f"  📝 {len(chunks)}개 청크 생성 (source={source})")

            # Qdrant에서 재개 지점 조회 (이전 실행 + 다른 파일의 upsert를 모두 반영)
            start_chunk = client.count(
                collection_name=settings.collection_name,
                count_filter=Filter(must=[
                    FieldCondition(key="volume", match=MatchValue(value=volume)),
                ]),
            ).count

            run_repo(lambda r, v=volume_key, tc=len(chunks): r.start_run(v, tc))
            if start_chunk > 0:
                run_repo(lambda r, v=volume_key, p=start_chunk: r.update_progress(v, p))

            def on_progress(abs_processed: int, v=volume_key):
                run_repo(lambda r: r.update_progress(v, abs_processed))

            stats = ingest_chunks(
                client, settings.collection_name, chunks,
                start_chunk=start_chunk,
                title=meta["title"] or volume_key,
                on_progress=on_progress,
            )

            final_processed = start_chunk + stats["chunk_count"]
            if stats.get("is_partial"):
                run_repo(lambda r, v=volume_key, p=final_processed: r.mark_partial(v, p))
            else:
                run_repo(lambda r, v=volume_key, tc=len(chunks): r.complete_job(v, tc))
            reporter.add_volume_stat(volume_key, stats["chunk_count"], stats["elapsed_sec"])

        except Exception as e:
            err_str = str(e)
            print(f"  ❌ 에러: {e}")
            run_repo(lambda r, v=volume_key, msg=err_str: r.fail_job(v, msg))
            reporter.add_error(volume_key, err_str)

            is_rate_limit = "429" in err_str or "rate" in err_str.lower() or "quota" in err_str.lower()
            if is_rate_limit:
                print(
                    f"\n🛑 Rate limit 3회 연속 실패 — RPD 쿼터 소진으로 판단합니다.\n"
                    f"   내일 자정(UTC) 이후 --resume 옵션으로 재시작하세요."
                )
                break

    report_path = reporter.generate(Path(args.report_dir))
    print(f"\n📊 리포트 생성: {report_path}")

    jobs = run_repo(lambda r: r.list_all())
    completed_count = sum(1 for j in jobs if j.status == IngestionStatus.COMPLETED)
    failed_count = sum(1 for j in jobs if j.status == IngestionStatus.FAILED)
    total_chunks = sum(j.total_chunks for j in jobs if j.status == IngestionStatus.COMPLETED)
    print(f"\n✅ 적재 완료: {completed_count}개 성공, {failed_count}개 실패, "
          f"총 {total_chunks}개 청크")


if __name__ == "__main__":
    main()
