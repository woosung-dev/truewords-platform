"""
통합 적재 스크립트. 멀티포맷(TXT/PDF/DOCX) + 증분 적재 + source 분류 + 리포트.

사용법:
  cd backend
  PYTHONPATH=. uv run python scripts/ingest.py <data_dir> [--resume] [--report-dir reports/]

예시:
  # 전체 적재 (처음부터)
  PYTHONPATH=. uv run python scripts/ingest.py "/Users/woosung/Downloads/말씀 앱 말씀 정리 부분/말씀(포너즈)"

  # 증분 적재 (이전에 실패한 것만 재시도)
  PYTHONPATH=. uv run python scripts/ingest.py "/Users/woosung/Downloads/말씀 앱 말씀 정리 부분/말씀(포너즈)" --resume

지원 형식: .txt, .pdf, .docx
HWP 파일은 스킵됩니다 (TXT로 변환 후 제공 필요).
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import settings
from src.pipeline.chunker import chunk_text
from src.pipeline.extractor import extract_text
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import classify_source, extract_metadata
from src.pipeline.progress import ProgressTracker
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


def main() -> None:
    parser = argparse.ArgumentParser(description="말씀 데이터 적재 파이프라인")
    parser.add_argument("data_dir", help="데이터 디렉토리 경로")
    parser.add_argument("--resume", action="store_true", help="이전 진행 이어서 적재")
    parser.add_argument("--report-dir", default="reports/", help="리포트 출력 디렉토리")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"오류: 디렉토리가 존재하지 않습니다: {data_dir}")
        sys.exit(1)

    # 파일 탐색
    files = find_files(data_dir)
    if not files:
        print(f"오류: {data_dir}에 지원되는 파일(.txt, .pdf, .docx)이 없습니다.")
        sys.exit(1)

    print(f"📁 {len(files)}개 파일 발견")

    # Qdrant 클라이언트
    client = get_client()

    # 진행 추적 (backend/ 디렉토리에 저장, 데이터 폴더와 분리)
    backend_dir = Path(__file__).parent.parent
    progress_path = backend_dir / "progress.json"
    if not args.resume and progress_path.exists():
        progress_path.unlink()
        print("🔄 이전 진행 기록 초기화")
    tracker = ProgressTracker(progress_path)
    if args.resume:
        summary = tracker.get_summary()
        print(f"📊 이전 진행: {summary['completed_count']}개 완료, {summary['failed_count']}개 실패")

    # 리포터
    reporter = BatchReporter()

    # 적재 루프
    total = len(files)
    for idx, filepath in enumerate(files, 1):
        # 상대 경로 기반 key: 서로 다른 폴더의 동명 파일 충돌 방지
        volume_key = str(filepath.relative_to(data_dir))

        # 증분: 이미 완료된 파일 스킵
        if args.resume and tracker.is_completed(volume_key):
            continue

        print(f"\n[{idx}/{total}] {filepath.name}")

        try:
            # 1. 텍스트 추출
            text = extract_text(filepath)
            if not text.strip():
                print(f"  ⚠️  빈 파일, 스킵")
                tracker.mark_failed(volume_key, "빈 파일")
                reporter.add_error(volume_key, "빈 파일")
                continue

            # 2. 메타데이터 추출 + source 분류
            meta = extract_metadata(filepath, text)
            source = classify_source(filepath)
            volume = meta["volume"] or volume_key

            # 3. 문장 경계 청킹
            chunks = chunk_text(
                text,
                volume=volume,
                max_chars=500,
                source=source,
                title=meta["title"],
                date=meta["date"],
            )
            print(f"  📝 {len(chunks)}개 청크 생성 (source={source})")

            # 4. Qdrant 적재 (청크 레벨 체크포인트 + title 품질 향상 포함)
            stats = ingest_chunks(
                client,
                settings.collection_name,
                chunks,
                start_chunk=tracker.get_resume_point(volume_key),
                title=meta["title"] or volume_key,
                tracker=tracker,
                volume_key=volume_key,
            )

            # 5. 진행 기록
            tracker.mark_completed(volume_key, stats["chunk_count"])
            reporter.add_volume_stat(volume_key, stats["chunk_count"], stats["elapsed_sec"])

        except Exception as e:
            err_str = str(e)
            print(f"  ❌ 에러: {e}")
            tracker.mark_failed(volume_key, err_str)
            reporter.add_error(volume_key, err_str)

            is_rate_limit = "429" in err_str or "rate" in err_str.lower() or "quota" in err_str.lower()
            if is_rate_limit:
                # 3회 연속 429 = RPD 소진 가능성이 높음 → 오늘 더 시도해도 낭비
                # 파이프라인 전체 중단. --resume으로 내일 이어서 실행.
                print(
                    f"\n🛑 Rate limit 3회 연속 실패 — RPD 쿼터 소진으로 판단합니다.\n"
                    f"   오늘({__import__('datetime').date.today()}) 더 이상 진행해도 RPD만 낭비됩니다.\n"
                    f"   내일 자정(UTC) 이후 --resume 옵션으로 재시작하세요.\n"
                    f"   완료: {tracker.get_summary()['completed_count']}개 / "
                    f"실패: {tracker.get_summary()['failed_count']}개"
                )
                break  # 파일 루프 중단

    # 리포트 생성
    report_path = reporter.generate(Path(args.report_dir))
    print(f"\n📊 리포트 생성: {report_path}")

    # 최종 요약
    summary = tracker.get_summary()
    print(f"\n✅ 적재 완료: {summary['completed_count']}개 성공, "
          f"{summary['failed_count']}개 실패, "
          f"총 {summary['total_chunks']}개 청크")


if __name__ == "__main__":
    main()
