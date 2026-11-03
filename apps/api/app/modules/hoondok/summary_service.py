"""요약 편집·공개 정책. 작업본과 불변 공개본을 분리한다."""

import uuid
from pathlib import Path
from fastapi import HTTPException
from app.modules.hoondok.summary_models import (
    SummaryUnit,
    SummaryRevision,
    SummaryAsset,
    now,
)
from app.modules.hoondok.summary_schemas import (
    SummaryInput,
    SummaryAdminResponse,
    SummaryMediaResponse,
    SummaryListItem,
    SummaryDetail,
    document_asset_ids,
)


class SummaryService:
    def __init__(self, repo, media_dir, source_client=None):
        self.source_client = source_client
        self.repo = repo
        self.media_dir = Path(media_dir)

    async def unit(self, unit_id, lock=False):
        unit = await self.repo.get(unit_id, lock)
        if not unit:
            raise HTTPException(404, "요약을 찾을 수 없습니다")
        return unit

    def media_url(self, unit_id, asset_id, admin=False):
        prefix = "/admin" if admin else ""
        return f"/api/backend{prefix}/hoondok/ai-summaries/{unit_id}/media/{asset_id}"

    async def admin_item(self, unit):
        assets = [
            self.asset_response(unit.id, a, True)
            for a in await self.repo.assets(unit.id)
        ]
        return SummaryAdminResponse(
            **unit.draft,
            id=unit.id,
            version=unit.version,
            review_status=unit.review_status,
            published=unit.published_revision_id is not None,
            assets=assets,
            updated_at=unit.updated_at,
        )

    async def check_right(self, right_id):
        right = await self.repo.right(right_id)
        if not right or right.status != "allowed" or not right.scope_full_text:
            raise HTTPException(404, "요약을 찾을 수 없습니다")
        return right

    async def list_public(self, right_id=None, volume=None):
        result = []
        for unit in await self.repo.units(right_id):
            right = await self.repo.right(unit.content_right_id)
            if (
                not right
                or right.status != "allowed"
                or not right.scope_full_text
                or (volume is not None and right.volume != volume)
            ):
                continue
            revision = (
                await self.repo.revision(unit.published_revision_id)
                if unit.published_revision_id
                else None
            )
            payload = revision.payload if revision else unit.draft
            result.append(
                SummaryListItem(
                    id=unit.id,
                    content_right_id=unit.content_right_id,
                    work_title=right.work_title,
                    group_title=payload["group_title"],
                    position=payload["position"],
                    title=payload["title"],
                    lead=payload["lead"] if revision else "",
                    published=revision is not None,
                    cover_url=self.media_url(unit.id, payload["slides"][0]["asset_id"])
                    if revision and payload["slides"]
                    else None,
                )
            )
        return sorted(result, key=lambda x: (x.work_title, x.position))

    async def published(self, unit_id):
        unit = await self.unit(unit_id)
        right = await self.check_right(unit.content_right_id)
        revision = (
            await self.repo.revision(unit.published_revision_id)
            if unit.published_revision_id
            else None
        )
        if not revision:
            raise HTTPException(404, "요약을 찾을 수 없습니다")
        return unit, right, revision.payload

    async def detail(self, unit_id):
        unit, right, payload = await self.published(unit_id)
        payload = dict(payload, source=dict(payload["source"], note=""))
        following = [
            i
            for i in await self.list_public(unit.content_right_id)
            if i.published and i.position > payload["position"]
        ]
        return SummaryDetail(
            **{k: v for k, v in payload.items() if k != "slides"},
            id=unit.id,
            volume=right.volume,
            work_title=right.work_title,
            published=True,
            cover_url=self.media_url(unit.id, payload["slides"][0]["asset_id"]),
            slides=[
                dict(**s, url=self.media_url(unit.id, s["asset_id"]))
                for s in payload["slides"]
            ],
            assets=[
                self.asset_response(unit.id, asset)
                for asset in await self.repo.assets(unit.id)
                if asset.id
                in document_asset_ids(payload["body"])
                | {uuid.UUID(s["asset_id"]) for s in payload["slides"]}
            ],
            next_id=following[0].id if following else None,
        )

    async def audit(self, unit, audit, actor, action):
        unit.updated_at = now()
        await self.repo.save(unit)
        await audit.log_audit(
            admin_user_id=actor,
            action=f"ai_summary.{action}",
            target_table="ai_summary_units",
            target_id=unit.id,
            changes={"version": unit.version, "review_status": unit.review_status},
        )
        return await self.admin_item(unit)

    async def resolve_source(self, data):
        if data.source_range_id is None:
            return data
        from app.modules.hoondok.source_repository import SourceRepository
        from app.modules.hoondok.source_service import SourceService
        from app.core.config import settings

        source = await SourceService(
            SourceRepository(self.repo.session),
            self.source_client,
            settings.collection_name,
        ).resolve(
            data.source_range_id, data.source_range_version, data.content_right_id
        )
        # 연결 성공과 운영자의 원문 검수는 별개다. 같은 원문을 명시적으로 확인한 경우만 유지한다.
        confirmed = (
            data.source.verified
            and data.source.text == source.text
            and data.source.sha256 == source.sha256
        )
        source = source.model_copy(update={"verified": confirmed})
        return data.model_copy(update={"source": source})

    async def create(self, data, audit, actor):
        data = await self.resolve_source(data)
        if not data.slug:
            data = data.model_copy(update={"slug": "summary-" + uuid.uuid4().hex[:12]})
        if data.position is None:
            existing = await self.repo.units(data.content_right_id)
            data = data.model_copy(
                update={
                    "position": max(
                        (u.draft.get("position", 0) or 0 for u in existing), default=0
                    )
                    + 1
                }
            )
        if not await self.repo.right(data.content_right_id):
            raise HTTPException(422, "등록된 원문을 선택하세요")
        if data.slides or document_asset_ids(data.body):
            raise HTTPException(422, "초안 생성 후 이미지를 업로드하세요")
        unit = SummaryUnit(
            content_right_id=data.content_right_id,
            slug=data.slug,
            draft=data.model_dump(mode="json"),
        )
        return await self.audit(unit, audit, actor, "create")

    def check_version(self, unit, version):
        if unit.version != version:
            raise HTTPException(409, "다른 관리자가 수정했습니다. 다시 불러와 주세요")

    def image_dimensions(self, filename):
        from PIL import Image

        try:
            with Image.open(self.media_dir / filename) as image:
                return image.size
        except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
            return None, None

    def asset_response(self, unit_id, asset, admin=False):
        width, height = self.image_dimensions(getattr(asset, "filename", ""))
        return SummaryMediaResponse(
            id=asset.id,
            mime_type=asset.mime_type,
            url=self.media_url(unit_id, asset.id, admin),
            width=width,
            height=height,
        )

    async def check_assets(self, unit, data):
        owned = {a.id for a in await self.repo.assets(unit.id)}
        body_ids = document_asset_ids(data.body)
        if (
            len({s.asset_id for s in data.slides}) != len(data.slides)
            or any(s.asset_id not in owned for s in data.slides)
            or not body_ids.issubset(owned)
        ):
            raise HTTPException(422, "이 요약에 업로드한 이미지만 사용할 수 있습니다")

    async def update(self, unit_id, data, audit, actor):
        unit = await self.unit(unit_id, True)
        self.check_version(unit, data.version)
        data = data.model_copy(
            update={
                "slug": data.slug or unit.slug,
                "position": data.position
                if data.position is not None
                else unit.draft["position"],
            }
        )
        if data.content_right_id != unit.content_right_id or data.slug != unit.slug:
            raise HTTPException(422, "원문 저작물과 고유 주소는 변경할 수 없습니다")
        data = await self.resolve_source(data)
        await self.check_assets(unit, data)
        unit.draft = data.model_dump(mode="json", exclude={"version"})
        unit.review_status = "draft"
        unit.version += 1
        return await self.audit(unit, audit, actor, "update")

    async def verify_source(self, payload):
        from app.core.config import settings
        from app.modules.hoondok.reading_content import _point_id
        from app.modules.search.hybrid import point_to_search_result
        from app.modules.datasource.chunk_merge import merge_with_dedup

        ids = [_point_id(i) for i in payload.source.chunk_ids]
        if any(i is None for i in ids) or len(set(ids)) != len(ids):
            raise HTTPException(422, "원문 범위를 다시 선택해 주세요")
        if self.source_client is None:
            raise HTTPException(503, "원문 연결 검증을 사용할 수 없습니다")
        try:
            records = await self.source_client.retrieve(
                settings.collection_name, ids=ids
            )
        except Exception:
            raise HTTPException(
                503, "원문 연결을 확인할 수 없습니다. 다시 시도하세요"
            ) from None
        right = await self.check_right(payload.content_right_id)
        chunks = sorted(
            [point_to_search_result(p) for p in records], key=lambda p: p.chunk_index
        )
        if len(chunks) != len(ids) or any(c.volume != right.volume for c in chunks):
            raise HTTPException(422, "선택한 책의 원문 범위가 아닙니다")
        indices = [c.chunk_index for c in chunks]
        if indices != list(range(indices[0], indices[0] + len(indices))):
            raise HTTPException(422, "이어지는 원문 범위를 선택해 주세요")
        if [str(c.chunk_id) for c in chunks] != [str(i) for i in ids]:
            raise HTTPException(422, "원문 범위를 읽기 순서에 맞게 다시 선택해 주세요")
        merged = merge_with_dedup(
            main_text=chunks[0].text, before=[], after=[c.text for c in chunks[1:]]
        ).merged_text
        normalize = lambda text: "".join(text.split())
        if normalize(payload.source.text) not in normalize(merged):
            raise HTTPException(422, "원문 내용이 바뀌었습니다. 범위를 다시 선택해 주세요")

    async def action(self, unit_id, data, audit, actor):
        unit = await self.unit(unit_id, True)
        self.check_version(unit, data.version)
        payload = SummaryInput.model_validate(unit.draft)
        if data.action == "withdraw":
            unit.published_revision_id = None
        elif data.action == "request_review":
            if unit.review_status != "draft":
                raise HTTPException(409, "초안에서 검수를 요청하세요")
            if (
                not payload.lead.strip()
                or not payload.key_points
                or not payload.body.get("content")
            ):
                raise HTTPException(422, "소개·핵심 정리·본문을 작성하세요")
            unit.review_status = "in_review"
        elif data.action == "approve":
            if unit.review_status != "in_review":
                raise HTTPException(409, "검수 요청된 초안만 승인할 수 있습니다")
            unit.review_status = "approved"
        else:
            if unit.review_status != "approved":
                raise HTTPException(409, "승인된 초안만 공개할 수 있습니다")
            await self.check_right(unit.content_right_id)
            if (
                not payload.source.verified
                or not payload.source.edition.strip()
                or not payload.source.locator.strip()
                or not payload.source.text.strip()
                or not payload.source.chunk_ids
            ):
                raise HTTPException(
                    422, "원문 범위를 선택하고 내용을 확인한 뒤 검수 완료로 표시해 주세요"
                )
            payload = await self.resolve_source(payload)
            await self.verify_source(payload)
            await self.check_assets(unit, payload)
            if len(payload.slides) < 2 or any(
                not s.alt.strip() for s in payload.slides
            ):
                raise HTTPException(
                    422, "대체 텍스트가 있는 이미지가 두 장 이상 필요합니다"
                )
            revision = SummaryRevision(
                unit_id=unit.id, version=unit.version, payload=unit.draft
            )
            await self.repo.save(revision)
            unit.published_revision_id = revision.id
        unit.version += 1
        return await self.audit(unit, audit, actor, data.action)

    async def upload(self, unit_id, blob, audit, actor):
        unit = await self.unit(unit_id, True)
        if len(blob) > 10 * 1024 * 1024:
            raise HTTPException(413, "이미지는 10MB 이하로 업로드하세요")
        from PIL import Image, UnidentifiedImageError
        from io import BytesIO

        try:
            with Image.open(BytesIO(blob)) as image:
                if image.format not in ("PNG", "JPEG", "WEBP"):
                    raise ValueError("지원하지 않는 이미지 형식")
                if image.width * image.height > 36000000:
                    raise ValueError("이미지 해상도 초과")
                image_format = image.format
                image.verify()
            with Image.open(BytesIO(blob)) as image:
                image.load()
        except (
            UnidentifiedImageError,
            OSError,
            ValueError,
            SyntaxError,
            Image.DecompressionBombError,
        ):
            raise HTTPException(
                422,
                "손상되지 않은 PNG·JPEG·WebP 이미지(3,600만 화소 이하)를 업로드하세요",
            ) from None
        mime, extension = {
            "PNG": ("image/png", "png"),
            "JPEG": ("image/jpeg", "jpg"),
            "WEBP": ("image/webp", "webp"),
        }[image_format]
        asset = SummaryAsset(unit_id=unit.id, mime_type=mime, filename="")
        asset.filename = f"{asset.id}.{extension}"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        path = self.media_dir / asset.filename
        try:
            path.write_bytes(blob)
            await self.repo.save(asset)
            await self.audit(unit, audit, actor, "upload")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return self.asset_response(unit.id, asset, True)

    async def media(self, unit_id, asset_id, admin=False):
        if admin:
            await self.unit(unit_id)
        else:
            _, _, payload = await self.published(unit_id)
            allowed = document_asset_ids(payload["body"]) | {
                uuid.UUID(s["asset_id"]) for s in payload["slides"]
            }
            if asset_id not in allowed:
                raise HTTPException(404, "이미지를 찾을 수 없습니다")
        asset = next(
            (a for a in await self.repo.assets(unit_id) if a.id == asset_id), None
        )
        if not asset or not (self.media_dir / asset.filename).is_file():
            raise HTTPException(404, "이미지를 찾을 수 없습니다")
        return self.media_dir / asset.filename, asset.mime_type
