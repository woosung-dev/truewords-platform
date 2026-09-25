"""훈독 AI 낭독 목소리 (PLAN-HD-011).

임의 텍스트는 받지 않는다 — 클라이언트는 식별자(원문 청크 id, 오늘 훈독 말씀 id + 단락 번호)만 보내고
서버가 화면에 보이는 본문을 직접 조회해 합성한다. 처음 들을 때 만들어 파일로 저장하고 이후에는 저장본을 준다.

- 캐시 키 = sha256(voice | speakingRate | 합성할 텍스트). 파일은 `{cache_dir}/{key[:2]}/{key}.mp3`,
  임시 파일에 쓴 뒤 `os.replace` 로 원자적으로 바꾼다.
- 같은 키 동시 요청은 프로세스 안 asyncio 락으로 한 번만 합성한다.
  [가정] backend 는 uvicorn 단일 워커(Dockerfile CMD)라 프로세스 락으로 충분하다. 워커를 늘리면 파일 락이 필요하다.
- 월 상한은 새로 합성한 글자 수(UTC 달별 합계)만 센다. 캐시 적중은 세지 않는다.
  [가정] 서로 다른 키가 동시에 상한 직전을 통과하면 요청 1~2건만큼 넘을 수 있다 — 상한이 무료 한도의 90% 라 허용한다.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from app.modules.hoondok.exceptions import TtsError
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.models import TtsUsage
from app.modules.hoondok.service import today_kst
from app.modules.hoondok.tts_google import TtsUpstreamError, synthesize_mp3
from app.modules.hoondok.tts_repository import TtsRepository
from app.modules.hoondok.tts_schemas import TtsVoice, TtsVoiceId, TtsVoicesResponse

logger = logging.getLogger(__name__)

# Chirp 3 HD 는 모든 목소리를 speakingRate 0.9 로 만든다. 화면의 0.8/1.0/1.2 는 재생 속도(playbackRate)다.
SPEAKING_RATE = 0.9
DEFAULT_VOICE: TtsVoiceId = "sulafat"


@dataclass(frozen=True)
class VoiceSpec:
    name: str  # Google voice name
    label: str
    description: str


VOICES: dict[str, VoiceSpec] = {
    "sulafat": VoiceSpec("ko-KR-Chirp3-HD-Sulafat", "차분한 여성", "따뜻하고 낮은 톤"),
    "aoede": VoiceSpec("ko-KR-Chirp3-HD-Aoede", "맑은 여성", "밝고 가벼운 톤"),
    "algieba": VoiceSpec("ko-KR-Chirp3-HD-Algieba", "부드러운 남성", "매끄럽고 편안한 톤"),
    "iapetus": VoiceSpec("ko-KR-Chirp3-HD-Iapetus", "또렷한 남성", "단정하고 분명한 톤"),
}

# 오늘 훈독 본문의 단락 = 빈 줄로 나뉜 덩어리. 웹의 splitReadingParagraphs 와 같은 규칙이다.
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")

SynthFn = Callable[[str, str], Awaitable[bytes]]  # (google voice name, text) → mp3


def split_paragraphs(body: str) -> list[str]:
    return [part.strip() for part in _PARAGRAPH_BREAK.split(body) if part.strip()]


def normalize_for_speech(text: str) -> str:
    """줄바꿈·연속 공백을 한 칸으로. 캐시 키와 과금 글자 수가 이 결과 기준이다."""
    return re.sub(r"\s+", " ", text).strip()


def cache_key(voice: str, text: str, speaking_rate: float = SPEAKING_RATE) -> str:
    return hashlib.sha256(f"{voice}|{speaking_rate}|{text}".encode()).hexdigest()


def utc_month(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


@dataclass(frozen=True)
class TtsAudio:
    content: bytes
    cache_key: str
    is_cached: bool


# 같은 키 동시 합성 방지. 락은 키마다 만들고, 기다리는 요청이 없으면 치운다.
_key_locks: dict[str, tuple[asyncio.Lock, int]] = {}


class _KeyLock:
    def __init__(self, key: str) -> None:
        self.key = key

    async def __aenter__(self) -> None:
        lock, users = _key_locks.get(self.key, (asyncio.Lock(), 0))
        _key_locks[self.key] = (lock, users + 1)
        await lock.acquire()

    async def __aexit__(self, *exc: object) -> None:
        lock, users = _key_locks[self.key]
        lock.release()
        if users <= 1:
            del _key_locks[self.key]
        else:
            _key_locks[self.key] = (lock, users - 1)


class TtsService:
    def __init__(
        self,
        repo: TtsRepository,
        journey: JourneyService,
        *,
        api_key: str | None,
        monthly_limit: int,
        cache_dir: str | Path,
        synth_fn: SynthFn | None = None,
        month_fn: Callable[[], str] = utc_month,
        today_fn: Callable[[], date] = today_kst,
    ) -> None:
        self.repo, self.journey = repo, journey
        self.api_key = (api_key or "").strip() or None
        self.monthly_limit = monthly_limit
        self.cache_dir = Path(cache_dir)
        self.synth_fn = synth_fn or self._google
        self.month_fn, self.today_fn = month_fn, today_fn

    @property
    def enabled(self) -> bool:
        return self.api_key is not None

    async def _google(self, voice_name: str, text: str) -> bytes:
        assert self.api_key is not None
        return await synthesize_mp3(text, voice_name=voice_name, speaking_rate=SPEAKING_RATE, api_key=self.api_key)

    async def voices(self) -> TtsVoicesResponse:
        limit_reached = self.enabled and await self.repo.month_chars(self.month_fn()) >= self.monthly_limit
        return TtsVoicesResponse(
            enabled=self.enabled,
            limit_reached=limit_reached,
            default_voice=DEFAULT_VOICE,
            voices=[
                TtsVoice(id=voice_id, label=spec.label, description=spec.description)  # type: ignore[arg-type]
                for voice_id, spec in VOICES.items()
            ],
        )

    def _check(self, voice: str) -> VoiceSpec:
        spec = VOICES.get(voice)
        if spec is None:
            raise TtsError(422, "TTS_INVALID_VOICE", "지원하지 않는 목소리예요")
        if not self.enabled:
            raise TtsError(503, "TTS_DISABLED", "AI 낭독이 아직 준비되지 않았어요")
        return spec

    @staticmethod
    def _not_found() -> TtsError:
        return TtsError(404, "TTS_SOURCE_NOT_FOUND", "읽을 본문을 찾을 수 없어요")

    async def chunk_audio(self, chunk_id: str, voice: str) -> TtsAudio:
        """원문 뷰 단락 1개. full_text 허용 저작물만."""
        spec = self._check(voice)
        text = await self.journey.chunk_display_text(chunk_id)
        if not text:
            raise self._not_found()
        return await self._audio(voice, spec, text)

    async def reading_audio(self, reading_id: uuid.UUID, paragraph: int, voice: str, user_id: uuid.UUID) -> TtsAudio:
        """오늘 훈독(/hoondok/read) 말씀의 단락 1개. 편성 말씀(daily_readings) 또는 내 정성 말씀(jeongseong_readings)."""
        spec = self._check(voice)
        body = await self._reading_body(reading_id, user_id)
        paragraphs = split_paragraphs(body) if body else []
        if not 0 <= paragraph < len(paragraphs):
            raise self._not_found()
        return await self._audio(voice, spec, paragraphs[paragraph])

    async def _reading_body(self, reading_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
        daily = await self.repo.get_daily_reading(reading_id)
        if daily is not None:
            # 공개된 편성만 — 철회됐거나 아직 오지 않은 날의 본문은 읽어 주지 않는다.
            if daily.review_status == "withdrawn" or daily.reading_date > self.today_fn():
                return None
            return daily.body
        found = await self.repo.get_jeongseong_reading(reading_id)
        if found is None:
            return None
        reading, owner_id = found
        # 정성 말씀은 본인 것만, 정성 권리가 지금도 허용된 저작물만.
        if owner_id != user_id or reading.volume not in await self.journey.allowed("scope_jeongseong"):
            return None
        return reading.body

    def _path(self, key: str) -> Path:
        return self.cache_dir / key[:2] / f"{key}.mp3"

    async def _read_cache(self, key: str) -> bytes | None:
        path = self._path(key)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except FileNotFoundError:
            return None
        except OSError:
            logger.exception("훈독 TTS 캐시 읽기 실패")
            return None

    async def _write_cache(self, key: str, content: bytes) -> None:
        path = self._path(key)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
            try:
                tmp.write_bytes(content)
                os.replace(tmp, path)
            finally:
                tmp.unlink(missing_ok=True)

        await asyncio.to_thread(write)

    async def _audio(self, voice: str, spec: VoiceSpec, raw_text: str) -> TtsAudio:
        text = normalize_for_speech(raw_text)
        if not text:
            raise self._not_found()
        key = cache_key(voice, text)
        cached = await self._read_cache(key)
        if cached is not None:
            return TtsAudio(cached, key, True)
        async with _KeyLock(key):
            # 락을 기다리는 동안 앞 요청이 만들었을 수 있다.
            cached = await self._read_cache(key)
            if cached is not None:
                return TtsAudio(cached, key, True)
            month = self.month_fn()
            if await self.repo.month_chars(month) + len(text) > self.monthly_limit:
                raise TtsError(429, "TTS_QUOTA_EXCEEDED", "이번 달 AI 낭독 한도에 도달했어요")
            try:
                content = await self.synth_fn(spec.name, text)
            except TtsUpstreamError:
                raise TtsError(502, "TTS_UPSTREAM_FAILED", "AI 낭독을 만들지 못했어요") from None
            if not content:
                raise TtsError(502, "TTS_UPSTREAM_FAILED", "AI 낭독을 만들지 못했어요")
            try:
                await self._write_cache(key, content)
            except OSError:
                # 볼륨 권한·디스크 부족이어도 듣기는 막지 않는다. 사용량은 그대로 세어 상한이 비용을 막는다.
                logger.exception("훈독 TTS 캐시 저장 실패")
            await self.repo.add_usage(TtsUsage(month=month, voice=voice, chars=len(text), cache_key=key))
            return TtsAudio(content, key, False)
