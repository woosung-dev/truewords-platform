"""훈독 AI 낭독 목소리 스키마 (PLAN-HD-011, API-HD-044)."""

from typing import Literal

from pydantic import BaseModel

TtsVoiceId = Literal["sulafat", "aoede", "algieba", "iapetus"]


class TtsVoice(BaseModel):
    id: TtsVoiceId
    label: str  # 화면 이름 "차분한 여성"
    description: str  # 한 줄 설명 "따뜻하고 낮은 톤"


class TtsVoicesResponse(BaseModel):
    """항상 200, 인증 없음. enabled=false 면 키가 없고, limit_reached=true 면 이번 달(UTC) 새 합성이 멈췄다.

    두 경우 모두 클라이언트는 브라우저 음성으로 돌아간다. 이미 만든 단락도 enabled=false 면 내려가지 않는다.
    """

    enabled: bool
    limit_reached: bool
    default_voice: TtsVoiceId
    voices: list[TtsVoice]
