"""검수 전 요약을 초안으로 임포트. 권리 생성·공개본 덮어쓰기를 하지 않는다.

uv run python scripts/import_ai_summaries.py content/ai-summaries/manifest.json --rights-map /path/rights.json
rights.json: {"천성경": "기존 content_right UUID"}
manifest 는 천성경 절 콘텐츠 JSON(slug·lead·key_points·body·evidence·reflection_questions·
uncertainty·images[{kind,file,alt,caption}]·source·generation)의 배열이다. 원문 전문은 넣지 않아도 된다.
이미지 file 은 manifest 폴더 기준 상대 경로다.
기존 slug는 건너뛴다. 실행 전 --dry-run 으로 판본·권리 연결을 확인한다.
"""

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlmodel import select
from app.core.common.database import async_session_factory
from app.core.config import settings
from app.modules.hoondok.models import ContentRight
from app.modules.hoondok.summary_models import SummaryUnit, SummaryAsset
from app.modules.hoondok.summary_schemas import SummaryInput
from app.modules.hoondok.summary_service import SummaryService, chunk_point_id
from app.modules.hoondok.summary_repository import SummaryRepository


async def run(args):
    manifest_path = Path(args.manifest).resolve()
    raw = json.loads(manifest_path.read_text())
    entries = raw if isinstance(raw, list) else raw["units"]
    rights = json.loads(Path(args.rights_map).read_text())
    async with async_session_factory() as session:
        svc = SummaryService(
            SummaryRepository(session), settings.hoondok_summary_media_dir
        )
        staged = []
        for entry in entries:
            work = entry["work_title"]
            if work not in rights:
                raise ValueError(f"{work}: --rights-map에 기존 원문 UUID를 지정하세요")
            right_id = uuid.UUID(rights[work])
            right = await session.get(ContentRight, right_id)
            if not right or right.work_title != work:
                raise ValueError(f"{work}: 권리 원장의 저작물 이름이 일치하지 않습니다")
            existing = (
                await session.execute(
                    select(SummaryUnit).where(SummaryUnit.slug == entry["slug"])
                )
            ).scalar_one_or_none()
            if existing:
                print(f"SKIP {entry['slug']} (기존 초안·공개본 보존)")
                continue
            payload = {
                k: v for k, v in entry.items() if k not in {"work_title", "images"}
            }
            payload["content_right_id"] = right_id
            payload["images"] = []
            payload["source"] = dict(
                payload.get("source", {}), verified=False, chunk_ids=[]
            )
            data = SummaryInput.model_validate(payload)
            for evidence in data.evidence:
                # 근거 링크는 권리 원장 volume 의 적재본을 가리켜야 한다.
                if evidence.chunk_index is not None and evidence.chunk_id != (
                    chunk_point_id(right.volume, evidence.chunk_index)
                ):
                    raise ValueError(
                        f"{data.slug}: 근거 chunk_id 가 {right.volume} 적재본과 다릅니다"
                    )
            unit = SummaryUnit(
                id=uuid.uuid5(uuid.NAMESPACE_URL, "truewords:summary:" + data.slug),
                content_right_id=right_id,
                slug=data.slug,
                draft=data.model_dump(mode="json"),
            )
            assets = []
            for number, image in enumerate(entry.get("images", [])):
                path = (manifest_path.parent / image["file"]).resolve()
                if not path.is_relative_to(manifest_path.parent):
                    raise ValueError("이미지는 manifest 폴더 안에 있어야 합니다")
                blob = path.read_bytes()
                extension = path.suffix.lower().lstrip(".")
                signatures = {
                    "png": blob.startswith(b"\x89PNG\r\n\x1a\n"),
                    "jpg": blob.startswith(b"\xff\xd8\xff"),
                    "jpeg": blob.startswith(b"\xff\xd8\xff"),
                    "webp": blob[:4] == b"RIFF" and blob[8:12] == b"WEBP",
                }
                if not signatures.get(extension) or len(blob) > 10 * 1024 * 1024:
                    raise ValueError(f"지원하지 않는 이미지: {path.name}")
                asset_id = uuid.uuid5(unit.id, str(number))
                asset = SummaryAsset(
                    id=asset_id,
                    unit_id=unit.id,
                    mime_type="image/"
                    + ("jpeg" if extension in {"jpg", "jpeg"} else extension),
                    filename=f"{asset_id}.{extension}",
                )
                assets.append((asset, blob))
                unit.draft["images"].append(
                    {
                        "kind": image["kind"],
                        "asset_id": str(asset_id),
                        "alt": image.get("alt", ""),
                        "caption": image.get("caption", ""),
                    }
                )
            # 그림 종류·개수 규칙을 저장 전 계약으로 다시 검사한다.
            SummaryInput.model_validate(unit.draft)
            staged.append((unit, assets))
            print(
                f"{'CHECK' if args.dry_run else 'IMPORT'} {data.slug}: {work}, 이미지 {len(assets)}장, 비공개 초안"
            )
        if args.dry_run:
            return
        created_paths = []
        try:
            svc.media_dir.mkdir(parents=True, exist_ok=True)
            for unit, assets in staged:
                session.add(unit)
                await session.flush()
                for asset, blob in assets:
                    path = svc.media_dir / asset.filename
                    if path.exists():
                        raise ValueError(f"기존 자산 파일과 충돌: {path.name}")
                    created_paths.append(path)
                    path.write_bytes(blob)
                    session.add(asset)
            await session.commit()
        except Exception:
            await session.rollback()
            for path in created_paths:
                path.unlink(missing_ok=True)
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("--rights-map", required=True)
    parser.add_argument("--dry-run", action="store_true")
    asyncio.run(run(parser.parse_args()))
