"""Google Cloud Text-to-Speech REST 호출 (PLAN-HD-011). 순수 전송층 — 캐시·상한·권리는 tts_service 가 맡는다.

- `POST https://texttospeech.googleapis.com/v1/text:synthesize`, MP3, languageCode ko-KR.
- API 키는 쿼리(`?key=`) 대신 `X-Goog-Api-Key` 헤더로 보낸다 — Google 이 같은 키로 받아 주고,
  httpx 요청 로그·예외 메시지에 URL 이 찍혀도 키가 남지 않는다.
- 요청 하나의 입력은 5,000바이트가 상한이다(한글 1자 = UTF-8 3바이트). 긴 단락은 문장 경계에서 나눠
  여러 번 합성하고 mp3 바이트를 이어 붙인다(MP3 프레임은 이어 붙여도 재생된다).
- 재시도(1회)는 Google 이 요청을 처리하지 않았다고 볼 수 있는 경우만 — 5xx·연결 실패. 읽기 타임아웃처럼
  이미 합성·과금됐을 수 있는 실패는 재시도하지 않는다(이중 과금 방지). 4xx 도 재시도하지 않는다.
- 실패하면 `TtsUpstreamError.billed_chars` 에 Google 이 과금했을 수 있는 글자 수(성공한 조각 + 결과를 모르는 조각)를
  싣는다 — 서비스가 사용량을 그만큼 남긴다.
"""

from __future__ import annotations

import base64
import re

import httpx

TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
LANGUAGE_CODE = "ko-KR"
# 5,000바이트 ÷ 3 ≈ 1,666자. 문장 경계를 찾을 여유를 두고 1,400자로 자른다.
MAX_CHARS_PER_REQUEST = 1400
# Google 은 요청 전체와 별개로 "문장 하나" 길이도 거절한다(400 "sentences that are too long").
# 2026-09-26 운영 실측: 한글 300자(716바이트) 통과, 340자(810바이트) 거절. 원리강론 830단락 중 5개가 걸렸다.
# 이보다 긴 문장은 쉼표에서 나눠 따로 요청한다 — 한글 1자 3바이트 기준 600바이트 이하로 여유를 둔다.
MAX_CHARS_PER_SENTENCE = 200
TIMEOUT_SECONDS = 20.0
_SENTENCE_END = re.compile(r"(?<=[.?!。])\s+")
_CLAUSE_END = re.compile(r"(?<=[,，])\s+")


class TtsUpstreamError(Exception):
    """Google 응답 실패. 메시지에 본문·키를 넣지 않는다 — 상태 코드만.

    billed_chars: 실패 전까지 Google 이 과금했을 수 있는 글자 수. 0 이면 과금되지 않았다고 본다.
    """

    def __init__(self, message: str, billed_chars: int = 0) -> None:
        super().__init__(message)
        self.billed_chars = billed_chars


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


def split_for_synthesis(
    text: str, limit: int = MAX_CHARS_PER_REQUEST, sentence_limit: int = MAX_CHARS_PER_SENTENCE
) -> list[str]:
    """요청마다 limit 자 이하, 문장마다 sentence_limit 자 이하가 되게 나눈다. 이어 붙이면 원문과 같다(공백 1칸 기준).

    짧은 문장은 limit 안에서 한 요청으로 묶는다. 긴 문장은 쉼표 → 글자 수 순서로 나눠 각각 따로 요청한다 —
    같은 요청에 이어 담으면 Google 이 다시 한 문장으로 본다.
    """
    sentence_limit = min(sentence_limit, limit)
    if len(text) <= sentence_limit:
        return [text]
    result: list[str] = []
    short: list[str] = []
    for sentence in _SENTENCE_END.split(text):
        if len(sentence) <= sentence_limit:
            short.append(sentence)
            continue
        result.extend(_pack(short, limit))
        short = []
        for clause in _pack(_CLAUSE_END.split(sentence), sentence_limit):
            # 쉼표도 없는 긴 문장은 글자 수로 자른다(드묾).
            result.extend(clause[i : i + sentence_limit] for i in range(0, len(clause), sentence_limit))
    result.extend(_pack(short, limit))
    return result


class _Retryable(Exception):
    """Google 이 요청을 처리하지 않았다고 볼 수 있는 실패 — 다시 보내도 이중 과금이 없다."""

    def __init__(self, status: int | None = None) -> None:
        super().__init__(f"Google TTS {status}" if status else "Google TTS 연결 실패")


class _Ambiguous(Exception):
    """보낸 뒤 결과를 모르는 실패(읽기 타임아웃·연결 끊김). 합성·과금됐을 수 있어 재시도하지 않는다."""


# 요청이 Google 에 닿기 전에 실패한 경우만 재시도한다.
_NOT_SENT = (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)


async def _post_once(client: httpx.AsyncClient, api_key: str, payload: dict) -> bytes:
    try:
        response = await client.post(TTS_ENDPOINT, json=payload, headers={"X-Goog-Api-Key": api_key})
    except _NOT_SENT:
        # 예외 문자열에 URL 이 들어가지만 키는 헤더라 남지 않는다. 그래도 원문은 버린다.
        raise _Retryable() from None
    except httpx.HTTPError:
        raise _Ambiguous() from None
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
    for _ in range(2):  # 최초 1회 + 재시도 1회 (_Retryable 만)
        try:
            return await _post_once(client, api_key, payload)
        except _Retryable as exc:
            last = exc
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
    billed = 0  # 성공한 조각 글자 수 — 뒤 조각이 실패해도 Google 은 앞 조각을 과금한다
    try:
        audio = b""
        for piece in split_for_synthesis(text):
            payload = {
                "input": {"text": piece},
                "voice": {"languageCode": LANGUAGE_CODE, "name": voice_name},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate},
            }
            try:
                audio += await _synthesize_piece(http, api_key, payload)
            except TtsUpstreamError as exc:
                raise TtsUpstreamError(str(exc), billed_chars=billed) from None
            except _Ambiguous:
                raise TtsUpstreamError("Google TTS 응답 없음", billed_chars=billed + len(piece)) from None
            billed += len(piece)
        return audio
    finally:
        if owns:
            await http.aclose()
