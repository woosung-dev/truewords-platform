"""스크린샷에 번호 마커 + 설명 박스를 입힌 '_annotated.png' 변형을 생성.

사용:
  uv run --project backend python docs/guides/annotate_screenshots.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS_DIR = Path(__file__).resolve().parent / "redteam-assets"

FONT_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
FONT_BOLD_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

MARKER_COLOR = (235, 62, 82)  # 빨간색 마커
CAPTION_BG = (255, 255, 255)
CAPTION_TEXT = (30, 30, 30)
CAPTION_BORDER = (235, 62, 82)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_PATH, size, index=2)
    except Exception:
        return ImageFont.load_default()


def draw_marker(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    number: int,
    radius: int = 22,
) -> None:
    x, y = center
    draw.ellipse(
        (x - radius, y - radius, x + radius, y + radius),
        fill=MARKER_COLOR,
        outline=(255, 255, 255),
        width=3,
    )
    font = load_font(24)
    text = str(number)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        (x - tw / 2 - bbox[0], y - th / 2 - bbox[1]),
        text,
        fill=(255, 255, 255),
        font=font,
    )


def draw_caption(
    draw: ImageDraw.ImageDraw,
    anchor: tuple[int, int],
    label: str,
    max_width: int = 520,
    pad: int = 12,
    font_size: int = 18,
) -> None:
    """anchor 지점 아래에 설명 박스 추가."""
    x, y = anchor
    font = load_font(font_size)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    box_w = min(tw + pad * 2, max_width)
    box_h = th + pad * 2
    # 화면 오른쪽 벗어나지 않도록 조정은 호출부 책임. 최소 왼쪽 경계만 보호.
    if x < 0:
        x = 10
    draw.rounded_rectangle(
        (x, y, x + box_w, y + box_h),
        radius=8,
        fill=CAPTION_BG,
        outline=CAPTION_BORDER,
        width=2,
    )
    draw.text((x + pad - bbox[0], y + pad - bbox[1]), label, fill=CAPTION_TEXT, font=font)


def draw_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    color=MARKER_COLOR,
    width: int = 3,
) -> None:
    draw.line([start, end], fill=color, width=width)
    # 화살촉 (간단)
    import math
    ex, ey = end
    sx, sy = start
    angle = math.atan2(ey - sy, ex - sx)
    size = 10
    p1 = (ex - size * math.cos(angle - math.pi / 6), ey - size * math.sin(angle - math.pi / 6))
    p2 = (ex - size * math.cos(angle + math.pi / 6), ey - size * math.sin(angle + math.pi / 6))
    draw.polygon([end, p1, p2], fill=color)


def annotate(src: Path, dst: Path, items: list[dict]) -> None:
    img = Image.open(src).convert("RGB")
    draw = ImageDraw.Draw(img)
    W, H = img.size
    for item in items:
        marker = item.get("marker")
        if marker:
            draw_marker(draw, marker, item["n"])
        caption_pos = item.get("caption_pos")
        if caption_pos and item.get("label"):
            draw_caption(draw, caption_pos, item["label"], font_size=item.get("font", 18))
        arrow = item.get("arrow")
        if arrow:
            draw_arrow(draw, arrow[0], arrow[1])
    img.save(dst, format="PNG", optimize=True)
    print(f"  ✓ {dst.name}")


# 각 스크린샷별 주석 좌표 (1440x900 기준, full page는 추가 높이 있음)
# 대부분 마커 + 박스형 캡션 또는 화살표만 사용.
# 실제 이미지 크기를 먼저 확인해 좌표 결정.


def annotate_all():
    print("주석 추가 시작...")

    # 01 클라이언트 초기 화면
    annotate(
        ASSETS_DIR / "01-client-chat-initial.png",
        ASSETS_DIR / "01-client-chat-initial-annotated.png",
        [
            {"n": 1, "marker": (1300, 48), "caption_pos": (1020, 90),
             "label": "① 챗봇 선택 — 용도별 챗봇 6종 중 선택"},
            {"n": 2, "marker": (713, 855), "caption_pos": (460, 820),
             "label": "② 질문 입력창 — 챗봇 선택 후 활성화"},
        ],
    )

    # 03 로그인 페이지 (1440x900)
    annotate(
        ASSETS_DIR / "03-login-page.png",
        ASSETS_DIR / "03-login-page-annotated.png",
        [
            {"n": 1, "marker": (1070, 432), "caption_pos": (850, 470),
             "label": "① 이메일 — 관리자 계정"},
            {"n": 2, "marker": (1070, 528), "caption_pos": (850, 566),
             "label": "② 비밀번호 — 입력 후 로그인 클릭"},
            {"n": 3, "marker": (1070, 625), "caption_pos": (850, 670),
             "label": "③ 로그인 버튼 — 관리자 대시보드로 이동"},
        ],
    )

    # 04 대시보드
    annotate(
        ASSETS_DIR / "04-admin-dashboard.png",
        ASSETS_DIR / "04-admin-dashboard-annotated.png",
        [
            {"n": 1, "marker": (115, 300), "caption_pos": (220, 270),
             "label": "① 좌측 메뉴 — 7개 주요 영역 이동"},
            {"n": 2, "marker": (540, 100), "caption_pos": (230, 30),
             "label": "② KPI 카드 — 챗봇/청크/질문/피드백 요약"},
            {"n": 3, "marker": (540, 420), "caption_pos": (230, 450),
             "label": "③ 빠른 이동 — 챗봇/데이터 소스로 바로가기"},
            {"n": 4, "marker": (540, 670), "caption_pos": (230, 700),
             "label": "④ 최근 챗봇 — 목록 및 편집 링크"},
        ],
    )

    # 05 챗봇 목록
    annotate(
        ASSETS_DIR / "05-admin-chatbots-list.png",
        ASSETS_DIR / "05-admin-chatbots-list-annotated.png",
        [
            {"n": 1, "marker": (1325, 130), "caption_pos": (1030, 85),
             "label": "① '새 챗봇' — 신규 챗봇 생성"},
            {"n": 2, "marker": (400, 270), "caption_pos": (500, 240),
             "label": "② 이름/ID/상태/티어 수/수정일 — 챗봇 메타 정보"},
            {"n": 3, "marker": (1310, 270), "caption_pos": (990, 310),
             "label": "③ 편집 — 프롬프트·검색 티어 수정"},
        ],
    )

    # 06 챗봇 편집 (키 영역)
    annotate(
        ASSETS_DIR / "06-admin-chatbot-edit.png",
        ASSETS_DIR / "06-admin-chatbot-edit-annotated.png",
        [
            {"n": 1, "marker": (420, 150), "caption_pos": (520, 125),
             "label": "① 기본 정보 — 이름/ID/활성 상태"},
            {"n": 2, "marker": (420, 410), "caption_pos": (520, 385),
             "label": "② 시스템 프롬프트 — 답변 톤·범위 지정"},
            {"n": 3, "marker": (420, 690), "caption_pos": (520, 670),
             "label": "③ Cascading 검색 티어 — source별 순차 폴백"},
            {"n": 4, "marker": (200, 625), "caption_pos": (150, 560),
             "label": "④ 저장 — 변경 사항 반영 (감사 로그 남음)"},
        ],
    )

    # 07 데이터 소스 (업로드 탭)
    annotate(
        ASSETS_DIR / "07-admin-data-sources-upload.png",
        ASSETS_DIR / "07-admin-data-sources-upload-annotated.png",
        [
            {"n": 1, "marker": (540, 140), "caption_pos": (230, 90),
             "label": "① KPI — Qdrant 실제 데이터 규모 반영"},
            {"n": 2, "marker": (360, 350), "caption_pos": (470, 325),
             "label": "② 탭 — '문서 업로드' / '카테고리 관리'"},
            {"n": 3, "marker": (725, 500), "caption_pos": (870, 470),
             "label": "③ 드래그앤드롭 영역 — TXT/PDF/DOCX 최대 50MB"},
            {"n": 4, "marker": (370, 650), "caption_pos": (470, 625),
             "label": "④ 처리 방식 — 즉시/배치 선택"},
        ],
    )

    # 08 데이터 소스 (카테고리 탭)
    annotate(
        ASSETS_DIR / "08-admin-data-sources-category.png",
        ASSETS_DIR / "08-admin-data-sources-category-annotated.png",
        [
            {"n": 1, "marker": (470, 355), "caption_pos": (575, 328),
             "label": "① 카테고리 관리 탭 활성화"},
            {"n": 2, "marker": (1270, 357), "caption_pos": (945, 395),
             "label": "② '새 카테고리' — 신규 분류 추가"},
            {"n": 3, "marker": (430, 500), "caption_pos": (530, 475),
             "label": "③ Key / 이름 / 문서 수 / 청크 / 색상 / 상태"},
            {"n": 4, "marker": (1300, 520), "caption_pos": (1000, 560),
             "label": "④ 편집·삭제 — 분류명 변경/비활성화"},
        ],
    )

    # 09 검색 분석
    annotate(
        ASSETS_DIR / "09-admin-analytics.png",
        ASSETS_DIR / "09-admin-analytics-annotated.png",
        [
            {"n": 1, "marker": (540, 130), "caption_pos": (230, 85),
             "label": "① 검색 통계 — 기간별 질문/폴백/지연 요약"},
            {"n": 2, "marker": (600, 355), "caption_pos": (230, 325),
             "label": "② 일별 질문 추이 — 사용 패턴 파악"},
            {"n": 3, "marker": (400, 580), "caption_pos": (230, 610),
             "label": "③ Fallback 유형 — 기본/완화/제안 비율"},
            {"n": 4, "marker": (1100, 580), "caption_pos": (890, 610),
             "label": "④ 인기 질문 Top 10"},
        ],
    )

    # 10 피드백
    annotate(
        ASSETS_DIR / "10-admin-feedback.png",
        ASSETS_DIR / "10-admin-feedback-annotated.png",
        [
            {"n": 1, "marker": (600, 265), "caption_pos": (230, 225),
             "label": "① 피드백 유형 분포 — 긍정/부정 비율"},
            {"n": 2, "marker": (600, 680), "caption_pos": (230, 635),
             "label": "② 최근 부정 피드백 — 질문·답변·사유 검토"},
        ],
    )

    # 11 감사 로그
    annotate(
        ASSETS_DIR / "11-admin-audit-logs.png",
        ASSETS_DIR / "11-admin-audit-logs-annotated.png",
        [
            {"n": 1, "marker": (440, 230), "caption_pos": (545, 200),
             "label": "① 시간 / 액션 / 대상 타입 / 변경 내용"},
            {"n": 2, "marker": (1310, 230), "caption_pos": (980, 260),
             "label": "② 상세 보기 — JSON diff 확인"},
        ],
    )

    # 12 설정
    annotate(
        ASSETS_DIR / "12-admin-settings.png",
        ASSETS_DIR / "12-admin-settings-annotated.png",
        [
            {"n": 1, "marker": (720, 255), "caption_pos": (820, 225),
             "label": "① 이메일 — 로그인에 쓰는 계정"},
            {"n": 2, "marker": (720, 345), "caption_pos": (820, 315),
             "label": "② 현재 비밀번호 — 변경 시 필수"},
            {"n": 3, "marker": (720, 435), "caption_pos": (820, 405),
             "label": "③ 새 비밀번호 + 확인"},
            {"n": 4, "marker": (550, 530), "caption_pos": (660, 500),
             "label": "④ '비밀번호 변경' 버튼"},
        ],
    )

    # 14 클라이언트 답변 (중요! 모든 레드팀 공격 시나리오 기준 화면)
    annotate(
        ASSETS_DIR / "14-client-chat-answer.png",
        ASSETS_DIR / "14-client-chat-answer-annotated.png",
        [
            {"n": 1, "marker": (940, 95), "caption_pos": (410, 60),
             "label": "① 사용자 질문 — 우측 말풍선"},
            {"n": 2, "marker": (100, 210), "caption_pos": (200, 175),
             "label": "② AI 답변 — 좌측 말풍선 (SSE 스트리밍)"},
            {"n": 3, "marker": (300, 550), "caption_pos": (400, 525),
             "label": "③ 출처(Citation) — 참조한 권 목록 + 카테고리 라벨"},
            {"n": 4, "marker": (500, 640), "caption_pos": (600, 620),
             "label": "④ 면책 고지 — 모든 답변에 자동 삽입 (제거 금지)"},
        ],
    )

    # 15 새 챗봇 생성 (Cascading 기본 모드) — 1425x1502
    annotate(
        ASSETS_DIR / "15-admin-chatbot-new.png",
        ASSETS_DIR / "15-admin-chatbot-new-annotated.png",
        [
            {"n": 1, "marker": (310, 232), "caption_pos": (380, 205),
             "label": "① 기본 정보 — Chatbot ID / 이름 / 활성화"},
            {"n": 2, "marker": (310, 540), "caption_pos": (380, 515),
             "label": "② 페르소나 + 시스템 프롬프트 — 답변 규칙 정의"},
            {"n": 3, "marker": (310, 940), "caption_pos": (380, 915),
             "label": "③ Query Rewriting — 질문 자동 확장 (기본 ON)"},
            {"n": 4, "marker": (310, 1030), "caption_pos": (380, 1005),
             "label": "④ 검색 전략 — Cascading / Weighted 중 선택"},
            {"n": 5, "marker": (355, 1370), "caption_pos": (435, 1345),
             "label": "⑤ '티어 추가' — 최소 1개 필수"},
        ],
    )

    # 17 새 챗봇 생성 (Weighted 모드 선택) — 1785x1512 (다른 뷰포트)
    annotate(
        ASSETS_DIR / "17-admin-chatbot-new-weighted.png",
        ASSETS_DIR / "17-admin-chatbot-new-weighted-annotated.png",
        [
            {"n": 1, "marker": (330, 1035), "caption_pos": (410, 1005),
             "label": "① Weighted 라디오 선택 — 비중 기반 검색"},
            {"n": 2, "marker": (330, 1185), "caption_pos": (410, 1160),
             "label": "② 티어 추가 — 모든 소스가 한 티어에 공존, 비중으로 차등"},
        ],
    )

    # 16 참부모론 전문 봇 편집 (Weighted 모드) — 1425x1695
    annotate(
        ASSETS_DIR / "16-admin-chatbot-edit-weighted.png",
        ASSETS_DIR / "16-admin-chatbot-edit-weighted-annotated.png",
        [
            {"n": 1, "marker": (310, 220), "caption_pos": (380, 195),
             "label": "① 기본 정보 — 이름 · Chatbot ID · 활성화"},
            {"n": 2, "marker": (310, 420), "caption_pos": (380, 395),
             "label": "② 시스템 프롬프트 — 참부모론 특화 규칙 추가됨"},
            {"n": 3, "marker": (310, 980), "caption_pos": (380, 955),
             "label": "③ 검색 전략: Weighted (비중 검색) 선택 상태"},
            {"n": 4, "marker": (310, 1180), "caption_pos": (380, 1155),
             "label": "④ Source별 가중치 — P=2.5 최고, M=1.8, L=1.5, 나머지 ↓"},
            {"n": 5, "marker": (310, 1620), "caption_pos": (380, 1595),
             "label": "⑤ 저장 — 감사 로그에 변경 내역 자동 기록"},
        ],
    )

    # 18 Weighted 테이블 전용 뷰포트 (1440x900)
    annotate(
        ASSETS_DIR / "18-weighted-table-viewport.png",
        ASSETS_DIR / "18-weighted-table-viewport-annotated.png",
        [
            {"n": 1, "marker": (335, 280), "caption_pos": (420, 252),
             "label": "① 검색 전략 — '비중 검색 (Weighted)' 라디오 선택 상태"},
            {"n": 2, "marker": (270, 395), "caption_pos": (340, 365),
             "label": "② '소스' 열 — 카테고리 선택 (중복 불가)"},
            {"n": 3, "marker": (690, 395), "caption_pos": (760, 365),
             "label": "③ '비중' 열 — 원하는 정수/소수 입력. 값이 클수록 우선"},
            {"n": 4, "marker": (870, 395), "caption_pos": (940, 365),
             "label": "④ '점수 임계값' — 이 값 미만 유사도는 무시 (0.1 기본)"},
            {"n": 5, "marker": (1130, 395), "caption_pos": (985, 425),
             "label": "⑤ '비율' — 합계 대비 자동 계산 (표시만, 입력 불필요)"},
            {"n": 6, "marker": (620, 720), "caption_pos": (700, 695),
             "label": "⑥ 합계 — 모든 비중의 합 (비율 100% 정규화 기준)"},
            {"n": 7, "marker": (620, 775), "caption_pos": (700, 750),
             "label": "⑦ '+ 소스 추가' — 새 카테고리 행 추가"},
        ],
    )

    print("\n완료 — annotated PNG 파일은 docs/guides/redteam-assets/ 에 생성됨")


if __name__ == "__main__":
    annotate_all()
