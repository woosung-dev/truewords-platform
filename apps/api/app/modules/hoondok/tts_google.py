"""Google Cloud Text-to-Speech REST 호출 (PLAN-HD-011). 순수 전송층 — 캐시·상한·권리는 tts_service 가 맡는다.

- `POST https://texttospeech.googleapis.com/v1/text:synthesize`, MP3, languageCode ko-KR.
- API 키는 쿼리(`?key=`) 대신 `X-Goog-Api-Key` 헤더로 보낸다 — Google 이 같은 키로 받아 주고,
  httpx 요청 로그·예외 메시지에 URL 이 찍혀도 키가 남지 않는다.
- 요청 하나의 입력은 5,000바이트가 상한이다(한글 1자 = UTF-8 3바이트). 긴 단락은 문장 경계에서 나눠
  여러 번 합성하고 mp3 바이트를 이어 붙인다(MP3 프레임은 이어 붙여도 재생된다).
- 5xx·타임아웃·네트워크 오류는 1회 재시도한다. 4xx 는 재시도하지 않는다.
"""

from __future__ import annotations

import base64
import re

import httpx

TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
LANGUAGE_CODE = "ko-KR"
# 5,000바이트 ÷ 3 ≈ 1,666자. 문장 경계를 찾을 여유를 두고 1,400자로 자른다.
MAX_CHARS_PER_REQUEST = 1400
TIMEOUT_SECONDS = 20.0
_SENTENCE_END = re.compile(r"(?<=[.?!。])\s+")
_CLAUSE_END = re.compile(r"(?<=[,，])\s+")


class TtsUpstreamError(Exception):
    """Google 응답 실패. 메시지에 본문·키를 넣지 않는다 — 상태 코드만."""


def _pack(parts: list[str], limit: int) -> list[str]:
    """조각을 limit 이하 묶음으로 합친다. 조각 하나가 limit 보다 길면 그대로 둔다(호출자가 더 쪼갠다)."""
    pieces: list[str] = []
    current = ""
    for part in parts:
        if current and len(current) + 1 + len(part) > limit:
            pieces.append(current)
            current = part
        else:
            current = f"{current} {part}" if current else part
    if current:
        pieces.append(current)
    return pieces


def split_for_synthesis(text: str, limit: int = MAX_CHARS_PER_REQUEST) -> list[str]:
    """문장 → 쉼표 → 글자 수 순서로 나눠 요청마다 limit 자 이하가 되게 한다. 이어 붙이면 원문과 같다(공백 1칸 기준)."""
    if len(text) <= limit:
        return [text]
    result: list[str] = []
    for piece in _pack(_SENTENCE_END.split(text), limit):
        if len(piece) <= limit:
            result.append(piece)
            continue
        for clause in _pack(_CLAUSE_END.split(piece), limit):
            # 쉼표도 없는 긴 문장은 글자 수로 자른다(드묾).
            result.extend(clause[i : i + limit] for i in range(0, len(clause), limit))
    return result


class _Retryable(Exception):
    def __init__(self, status: int | None = None) -> None:
        super().__init__(f"Google TTS {status}" if status else "Google TTS 네트워크 오류")


async def _post_once(client: httpx.AsyncClient, api_key: str, payload: dict) -> bytes:
    response = await client.post(TTS_ENDPOINT, json=payload, headers={"X-Goog-Api-Key": api_key})
    if response.status_code >= 500:
        raise _Retryable(response.status_code)
    if response.status_code != 200:
        raise TtsUpstreamError(f"Google TTS {response.status_code}")
    try:
        return base64.b64decode(response.json()["audioContent"])
    except (ValueError, KeyError, TypeError):
        raise TtsUpstreamError("Google TTS 응답 형식 오류") from None


async def _synthesize_piece(client: httpx.AsyncClient, api_key: str, payload: dict) -> bytes:
    last: Exception | None = None
    for _ in range(2):  # 최초 1회 + 재시도 1회
        try:
            return await _post_once(client, api_key, payload)
        except _Retryable as exc:
            last = exc
        except httpx.HTTPError:
            # 예외 문자열에 URL 이 들어가지만 키는 헤더라 남지 않는다. 그래도 원문은 버린다.
            last = _Retryable()
    raise TtsUpstreamError(str(last)) from None


async def synthesize_mp3(
    text: str,
    *,
    voice_name: str,
    speaking_rate: float,
    api_key: str,
    client: httpx.AsyncClient | None = None,
) -> bytes:
    """text 를 mp3 로 합성한다. 긴 텍스트는 여러 요청으로 나눠 이어 붙인다."""
    owns = client is None
    http = client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
    try:
        audio = b""
        for piece in split_for_synthesis(text):
            payload = {
                "input": {"text": piece},
                "voice": {"languageCode": LANGUAGE_CODE, "name": voice_name},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate},
            }
            audio += await _synthesize_piece(http, api_key, payload)
        return audio
    finally:
        if owns:
            await http.aclose()
