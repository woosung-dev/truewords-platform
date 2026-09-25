"""훈독 AI 낭독 목소리 API (PLAN-HD-011, API-HD-044~046).

목록(044)은 공개. 단락 음성(045·046)은 hoondok_token 로그인 사용자만 — 합성 비용이 드는 경로라
비로그인 읽기(원문·오늘 말씀은 공개)와 달리 계정을 요구한다. 비로그인은 클라이언트가 브라우저 음성을 쓴다.
"""

import uuid

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import Response

from app.core.common.schemas import ErrorResponse
from app.modules.hoondok.dependencies import get_tts_service
from app.modules.hoondok.tts_schemas import TtsVoicesResponse
from app.modules.hoondok.tts_service import TtsAudio, TtsService
from app.modules.identity.dependencies import get_current_user
from app.modules.identity.models import User
from app.modules.safety.middleware import extract_client_ip
from app.modules.safety.rate_limiter import RateLimiter

router = APIRouter(prefix="/hoondok/tts", tags=["hoondok"])

# 구간 20단락을 이어 들으며 다음 단락을 미리 받는다 — 정상 청취는 분당 10건 안팎이다. [가정] 인메모리·단일 워커.
tts_limiter = RateLimiter(max_requests=60, window_seconds=60)
# 파일 내용은 (목소리, 본문)에 묶여 바뀌지 않는다. 본문 정리 규칙이 바뀌어도 30일이면 새로 받는다.
AUDIO_CACHE_CONTROL = "private, max-age=2592000"

_errors = {
    code: {"model": ErrorResponse, "description": desc}
    for code, desc in {
        401: "로그인 필요",
        404: "TTS_SOURCE_NOT_FOUND — 본문 없음·권리 없음·단락 번호 범위 밖",
        422: "TTS_INVALID_VOICE — 알 수 없는 목소리",
        429: "TTS_QUOTA_EXCEEDED — 이번 달 글자 상한 (또는 RATE_LIMIT_EXCEEDED)",
        502: "TTS_UPSTREAM_FAILED — Google 오류·네트워크",
        503: "TTS_DISABLED — GOOGLE_TTS_API_KEY 미설정",
    }.items()
}
_audio_responses = {200: {"content": {"audio/mpeg": {}}, "description": "단락 mp3"}, **_errors}


async def check_tts_limit(request: Request) -> None:
    tts_limiter.check(extract_client_ip(request))


def _mp3(audio: TtsAudio) -> Response:
    return Response(
        content=audio.content,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": AUDIO_CACHE_CONTROL,
            "ETag": f'"{audio.cache_key}"',
            "X-Tts-Cache": "hit" if audio.is_cached else "miss",
        },
    )


@router.get("/voices", response_model=TtsVoicesResponse)
async def get_tts_voices(service: TtsService = Depends(get_tts_service)) -> TtsVoicesResponse:
    """API-HD-044 목소리 4종 + 켜짐 여부 + 이번 달 상한 도달 여부. 항상 200, 인증 없음."""
    return await service.voices()


@router.get(
    "/chunks/{chunk_id}",
    response_class=Response,
    responses=_audio_responses,
    dependencies=[Depends(check_tts_limit)],
)
async def get_chunk_audio(
    chunk_id: str = Path(max_length=128),
    voice: str = Query(max_length=16),
    user: User = Depends(get_current_user),
    service: TtsService = Depends(get_tts_service),
) -> Response:
    """API-HD-045 원문 뷰 단락(청크) 1개의 mp3. 본문은 서버가 display_text 로 조회한다."""
    return _mp3(await service.chunk_audio(chunk_id, voice))


@router.get(
    "/readings/{reading_id}/{paragraph}",
    response_class=Response,
    responses=_audio_responses,
    dependencies=[Depends(check_tts_limit)],
)
async def get_reading_audio(
    reading_id: uuid.UUID,
    paragraph: int = Path(ge=0, le=200),
    voice: str = Query(max_length=16),
    user: User = Depends(get_current_user),
    service: TtsService = Depends(get_tts_service),
) -> Response:
    """API-HD-046 오늘 훈독 말씀(편성 또는 내 정성)의 단락 1개 mp3. 단락 = 본문을 빈 줄로 나눈 순서(0부터)."""
    return _mp3(await service.reading_audio(reading_id, paragraph, voice, user.id))
