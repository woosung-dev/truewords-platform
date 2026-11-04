"""AI 요약 편집·공개 계약. HTML 대신 제한된 Tiptap JSON을 보존한다."""

import hashlib
import uuid
from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def document_asset_ids(document: dict[str, Any]) -> set[uuid.UUID]:
    """본문의 안정 자산 ID만 수집한다. URL은 저장하지 않는다."""
    result: set[uuid.UUID] = set()

    def walk(node):
        if node.get("type") == "image":
            result.add(uuid.UUID(node["attrs"]["asset_id"]))
        for child in node.get("content", []):
            walk(child)

    walk(document)
    return result


def validate_document(value: dict[str, Any]) -> dict[str, Any]:
    import re

    nodes = {
        "doc",
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "text",
        "hardBreak",
        "image",
        "imageRow",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "youtube",
    }
    marks = {"bold", "italic", "underline", "link", "highlight", "textStyle"}
    blocks = {
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "blockquote",
        "image",
        "imageRow",
        "table",
        "youtube",
    }
    count = 0

    def integer(value, low, high):
        return type(value) is int and low <= value <= high

    def color(value):
        return (
            isinstance(value, str)
            and re.fullmatch(
                r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})", value
            )
            is not None
        )

    def walk(node, depth=0):
        nonlocal count
        count += 1
        if (
            count > 10000
            or depth > 20
            or not isinstance(node, dict)
            or not isinstance(node.get("type"), str)
            or node["type"] not in nodes
        ):
            raise ValueError("지원하지 않는 본문 구조입니다")
        if set(node) - {"type", "content", "attrs", "marks", "text"}:
            raise ValueError("지원하지 않는 본문 속성입니다")
        kind = node["type"]
        attrs = node.get("attrs")
        attrs = {} if attrs is None else attrs
        if not isinstance(attrs, dict):
            raise ValueError("문단 속성은 객체여야 합니다")
        allowed = {
            "paragraph": {"textAlign"},
            "heading": {"level", "textAlign"},
            "orderedList": {"start", "type"},
            "image": {"asset_id", "alt", "caption", "width_percent", "align"},
            "tableCell": {"colspan", "rowspan", "colwidth"},
            "tableHeader": {"colspan", "rowspan", "colwidth"},
            "youtube": {"video_id", "start_seconds"},
        }.get(kind, set())
        if set(attrs) - allowed:
            raise ValueError("지원하지 않는 문단 속성입니다")
        if kind == "heading" and attrs.get("level") not in (2, 3):
            raise ValueError("소제목은 H2 또는 H3만 사용할 수 있습니다")
        if kind in ("paragraph", "heading") and attrs.get("textAlign") not in (
            None,
            "left",
            "center",
            "right",
            "justify",
        ):
            raise ValueError("문단 정렬을 확인하세요")
        if kind == "orderedList" and (
            not integer(attrs.get("start", 1), 1, 1000000)
            or attrs.get("type") not in (None, "1", "a", "A", "i", "I")
        ):
            raise ValueError("목록 번호 형식을 확인하세요")
        if kind == "image":
            try:
                uuid.UUID(attrs.get("asset_id", ""))
            except (ValueError, TypeError, AttributeError):
                raise ValueError("업로드한 이미지의 자산 ID가 필요합니다") from None
            if not integer(attrs.get("width_percent", 100), 25, 100) or attrs.get(
                "align", "center"
            ) not in ("left", "center", "right"):
                raise ValueError("이미지 크기와 정렬을 확인하세요")
            for key, limit in [("alt", 500), ("caption", 1000)]:
                if (
                    not isinstance(attrs.get(key, ""), str)
                    or len(attrs.get(key, "")) > limit
                ):
                    raise ValueError("이미지 설명을 확인하세요")
        if kind in ("tableCell", "tableHeader"):
            if not integer(attrs.get("colspan", 1), 1, 20) or not integer(
                attrs.get("rowspan", 1), 1, 100
            ):
                raise ValueError("표 병합 범위를 확인하세요")
            widths = attrs.get("colwidth")
            if widths is not None and (
                not isinstance(widths, list)
                or len(widths) != attrs.get("colspan", 1)
                or any(not integer(w, 1, 2000) for w in widths)
            ):
                raise ValueError("표 열 너비를 확인하세요")
        if kind == "youtube":
            if (
                not isinstance(attrs.get("video_id"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{11}", attrs["video_id"])
                or not integer(attrs.get("start_seconds", 0), 0, 2147483647)
            ):
                raise ValueError("올바른 YouTube 영상 ID와 시작 시간이 필요합니다")
        children, mark_list = node.get("content", []), node.get("marks", [])
        if not isinstance(children, list) or not isinstance(mark_list, list):
            raise ValueError("본문 내용과 서식은 배열이어야 합니다")
        if kind == "text":
            if (
                not isinstance(node.get("text"), str)
                or not node["text"]
                or len(node["text"]) > 50000
            ):
                raise ValueError("본문 텍스트를 확인하세요")
        elif "text" in node or mark_list:
            raise ValueError("텍스트에만 서식을 적용할 수 있습니다")
        child_types = [c.get("type") if isinstance(c, dict) else None for c in children]
        permitted = {
            "paragraph": {"text", "hardBreak"},
            "heading": {"text", "hardBreak"},
            "bulletList": {"listItem"},
            "orderedList": {"listItem"},
            "table": {"tableRow"},
            "tableRow": {"tableCell", "tableHeader"},
            "imageRow": {"image"},
        }.get(
            kind,
            blocks
            if kind in ("doc", "blockquote", "listItem", "tableCell", "tableHeader")
            else set(),
        )
        if any(not isinstance(t, str) or t not in permitted for t in child_types):
            raise ValueError("본문 문단의 중첩 구조를 확인하세요")
        if kind == "listItem" and (not child_types or child_types[0] != "paragraph"):
            raise ValueError("목록 항목은 문단으로 시작해야 합니다")
        if (
            kind
            in (
                "bulletList",
                "orderedList",
                "blockquote",
                "table",
                "tableRow",
                "tableCell",
                "tableHeader",
            )
            and not children
        ):
            raise ValueError("비어 있는 목록·인용·표를 확인하세요")
        if kind == "imageRow" and len(children) != 2:
            raise ValueError("이미지 나란히 배치에는 두 장이 필요합니다")
        for mark in mark_list:
            if (
                not isinstance(mark, dict)
                or not isinstance(mark.get("type"), str)
                or mark["type"] not in marks
                or set(mark) - {"type", "attrs"}
            ):
                raise ValueError("지원하지 않는 서식입니다")
            ma = mark.get("attrs")
            ma = {} if ma is None else ma
            if not isinstance(ma, dict):
                raise ValueError("서식 속성은 객체여야 합니다")
            if mark["type"] == "link":
                href = ma.get("href", "")
                if (
                    not isinstance(href, str)
                    or urlsplit(href).scheme not in ("http", "https")
                    or set(ma) - {"href", "target", "rel", "class"}
                    or any(
                        v is not None and not isinstance(v, str) for v in ma.values()
                    )
                ):
                    raise ValueError("http(s) 링크만 사용할 수 있습니다")
            elif mark["type"] == "highlight":
                if set(ma) - {"color"} or (
                    ma.get("color") is not None and not color(ma["color"])
                ):
                    raise ValueError("강조 색상은 HEX 색상만 사용할 수 있습니다")
            elif mark["type"] == "textStyle":
                if set(ma) - {"color", "fontSize"} or (
                    ma.get("color") is not None and not color(ma["color"])
                ):
                    raise ValueError("글자 색상은 HEX 색상만 사용할 수 있습니다")
                size = ma.get("fontSize")
                if size is not None and (
                    not isinstance(size, str)
                    or not re.fullmatch(r"(?:1[2-9]|[2-5][0-9]|6[0-4])px", size)
                ):
                    raise ValueError("글자 크기는 12~64px만 사용할 수 있습니다")
            elif ma:
                raise ValueError("지원하지 않는 서식 속성입니다")
        for child in children:
            walk(child, depth + 1)

    if value.get("type") != "doc":
        raise ValueError("본문 문서가 필요합니다")
    walk(value)
    return value


class SummarySource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    edition: str = Field(default="", max_length=300)
    locator: str = Field(default="", max_length=500)
    # 원문 전문은 선택이다. 근거는 paragraph_from·to 말씀 번호 범위로 남긴다.
    text: str = Field(default="", max_length=100000)
    # text 가 있으면 그 해시, 없으면 판본 파일 해시(콘텐츠 계약의 source.sha256)를 보존한다.
    sha256: str = Field(default="", max_length=64)
    paragraph_from: int | None = Field(default=None, ge=1)
    paragraph_to: int | None = Field(default=None, ge=1)
    chunk_ids: list[str] = Field(default_factory=list, max_length=300)
    verified: bool = False
    note: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def check_hash(self):
        if (
            self.paragraph_from is not None
            and self.paragraph_to is not None
            and self.paragraph_to < self.paragraph_from
        ):
            raise ValueError("원문 말씀 번호 범위를 확인하세요")
        if not self.text:
            return self
        expected = hashlib.sha256(self.text.encode()).hexdigest()
        if self.sha256 and self.sha256 != expected:
            raise ValueError("원문 해시가 일치하지 않습니다")
        self.sha256 = expected
        return self


class SummaryPublicSource(BaseModel):
    """공개 응답의 원문 정보. 검수 메모·검수 여부는 담지 않는다."""

    edition: str = ""
    locator: str = ""
    text: str = ""
    paragraph_from: int | None = None
    paragraph_to: int | None = None
    chunk_ids: list[str] = Field(default_factory=list)


class SummaryEvidence(BaseModel):
    """요약 문장의 근거 — 절 안 말씀 번호 범위."""

    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )
    claim: str = Field(min_length=1, max_length=500)
    from_: int = Field(alias="from", ge=1)
    to: int = Field(ge=1)
    # 말씀 from 이 시작하는 원문 뷰 단락. 없으면 원문 뷰는 장 첫머리로 간다.
    # chunk_id 는 적재 규칙 uuid5("{volume}:{chunk_index}") 값이라 같은 적재본이면 환경과 무관하다.
    chunk_index: int | None = Field(default=None, ge=0)
    chunk_id: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def check_range(self):
        if self.to < self.from_:
            raise ValueError("근거 말씀 번호 범위를 확인하세요")
        return self


class SummaryImage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["concept", "scene"]
    asset_id: uuid.UUID
    alt: str = Field(default="", max_length=500)
    caption: str = Field(default="", max_length=1000)


class SummaryGeneration(BaseModel):
    """생성 기록 — 관리자 응답에만 포함한다."""

    model_config = ConfigDict(extra="forbid")
    text_model: str = Field(default="", max_length=100)
    text_score: float = 0
    text_rounds: int = Field(default=0, ge=0)
    image_scores: dict[str, float] = Field(default_factory=dict, max_length=10)
    image_rounds: dict[str, int] = Field(default_factory=dict, max_length=10)


SummaryStatus = Literal["draft", "review", "published", "withdrawn"]


class SummaryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content_right_id: uuid.UUID
    source_range_id: uuid.UUID | None = None
    source_range_version: int | None = Field(default=None, ge=1)
    slug: str = Field(default="", pattern=r"^(?:[a-z0-9][a-z0-9-]{0,99})?$")
    group_title: str = Field(default="", max_length=300)
    position: int | None = Field(default=None, ge=1)
    title: str = Field(min_length=1, max_length=200)
    lead: str = Field(default="", max_length=1000)
    key_points: list[str] = Field(default_factory=list, max_length=10)
    body: dict[str, Any] = Field(default_factory=lambda: {"type": "doc", "content": []})
    body_version: Literal[1, 2] = 1
    evidence: list[SummaryEvidence] = Field(default_factory=list, max_length=20)
    reflection_questions: list[str] = Field(default_factory=list, max_length=5)
    uncertainty: list[str] = Field(default_factory=list, max_length=20)
    source: SummarySource = Field(default_factory=SummarySource)
    images: list[SummaryImage] = Field(default_factory=list, max_length=2)
    generation: SummaryGeneration = Field(default_factory=SummaryGeneration)
    _body = field_validator("body")(validate_document)

    @field_validator("images")
    @classmethod
    def unique_kinds(cls, value):
        if len({image.kind for image in value}) != len(value):
            raise ValueError("개념·장면 그림은 한 장씩만 둘 수 있습니다")
        return value


class SummaryUpdate(SummaryInput):
    version: int = Field(ge=1)


class SummaryActionInput(BaseModel):
    # draft→review(request_review), review→draft(return_to_draft),
    # review·withdrawn→published(publish), 공개 중→withdrawn(withdraw)
    action: Literal["request_review", "return_to_draft", "publish", "withdraw"]
    version: int = Field(ge=1)


class SummaryMediaResponse(BaseModel):
    id: uuid.UUID
    url: str
    mime_type: str
    width: int | None = None
    height: int | None = None


class SummaryAdminResponse(SummaryInput):
    id: uuid.UUID
    version: int
    review_status: SummaryStatus
    published: bool
    assets: list[SummaryMediaResponse]
    updated_at: datetime


class SummaryTocItem(BaseModel):
    """관리자 발행 관리 목록 한 행 — 천성경 절 하나."""

    slug: str
    pyeon_no: int
    pyeon_title: str
    jang_no: int
    jang_title: str
    jeol_no: int
    jeol_title: str
    paragraph_count: int
    unit_id: uuid.UUID | None = None
    status: Literal["none", "draft", "review", "published", "withdrawn"] = "none"
    published: bool = False
    image_count: int = 0
    text_score: float | None = None
    updated_at: datetime | None = None


class SummaryListItem(BaseModel):
    id: uuid.UUID
    content_right_id: uuid.UUID
    work_title: str
    slug: str
    group_title: str
    position: int
    title: str
    lead: str
    # 원문 뷰 목차의 장 위치(volume_sections.position). 찾지 못하면 null.
    section_position: int | None = None
    cover_url: str | None = None


class SummaryPublicImage(BaseModel):
    kind: Literal["concept", "scene"]
    asset_id: uuid.UUID
    alt: str
    caption: str
    url: str


class SummaryDetail(SummaryListItem):
    body_version: Literal[1, 2] = 1
    assets: list[SummaryMediaResponse] = Field(default_factory=list)
    volume: str
    key_points: list[str]
    body: dict[str, Any]
    evidence: list[SummaryEvidence]
    reflection_questions: list[str]
    source: SummaryPublicSource
    images: list[SummaryPublicImage]
    next_id: uuid.UUID | None = None
