"""훈독 AI 낭독 목소리 (PLAN-HD-011).

임의 텍스트는 받지 않는다 — 클라이언트는 식별자(원문 청크 id, 오늘 훈독 말씀 id + 단락 번호)만 보내고
서버가 화면에 보이는 본문을 직접 조회해 합성한다. 처음 들을 때 만들어 파일로 저장하고 이후에는 저장본을 준다.

- 캐시 키 = sha256(voice | speakingRate | 합성할 텍스트). 파일은 `{cache_dir}/{key[:2]}/{key}.mp3`,
  임시 파일에 쓴 뒤 `os.replace` 로 원자적으로 바꾼다.
- 같은 키 동시 요청은 프로세스 안 asyncio 락으로 한 번만 합성한다.
  [가정] backend 는 uvicorn 단일 워커(Dockerfile CMD)라 프로세스 락으로 충분하다. 워커를 늘리면 파일·DB 락이 필요하다.
- 한도는 새로 합성한 글자 수만 센다(캐시 적중은 세지 않는다). 월 상한은 Google 청구 달(America/Los_Angeles)별 합계,
  사용자 한도는 최근 24시간 합계다. 상한 검사와 사용량 예약을 한 전역 락 안에서 끝내고 커밋한 뒤 Google 을 부른다 —
  서로 다른 단락이 동시에 와도 상한을 넘지 않고, 호출 동안 DB 커넥션을 쥐지 않는다.
- 합성이 실패하면 예약을 Google 이 과금했을 수 있는 글자 수로 줄이거나 지운다. 시간 초과는 결과를 모르니 그대로 둔다.
- 캐시 디렉터리에 쓸 수 없으면 기능을 끈다(503 TTS_DISABLED) — 매 청취가 새 합성으로 세어져 한도를 조용히 쓰지 않게.
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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from weakref import WeakKeyDictionary
from zoneinfo import ZoneInfo

from app.modules.hoondok.exceptions import TtsError
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.models import TtsUsage, _utcnow
from app.modules.hoondok.service import today_kst
from app.modules.hoondok.tts_google import TtsUpstreamError, synthesize_mp3
from app.modules.hoondok.tts_repository import TtsRepository
from app.modules.hoondok.tts_schemas import TtsVoice, TtsVoiceId, TtsVoicesResponse

logger = logging.getLogger(__name__)

# Chirp 3 HD 는 모든 목소리를 speakingRate 0.9 로 만든다. 화면의 0.8/1.0/1.2 는 재생 속도(playbackRate)다.
SPEAKING_RATE = 0.9
DEFAULT_VOICE: TtsVoiceId = "sulafat"
# 요청 하나(조각 여러 개 + 재시도 포함)의 합성 시간 상한. Cloudflare 100초보다 한참 짧게.
REQUEST_TIMEOUT_SECONDS = 45.0
# 사용자 한도의 창. 달력 날짜가 아니라 최근 24시간이다(시간대와 무관).
USER_WINDOW = timedelta(hours=24)
# Google Cloud 청구 달은 태평양 시간 기준이다. 월 상한을 같은 달로 센다.
BILLING_TZ = ZoneInfo("America/Los_Angeles")


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


def billing_month(now: datetime | None = None) -> str:
    """Google 청구 달 "YYYY-MM" (America/Los_Angeles). now 는 aware datetime(기본 지금)."""
    return (now or datetime.now(timezone.utc)).astimezone(BILLING_TZ).strftime("%Y-%m")


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


# 상한 검사 + 사용량 예약을 한 번에 하나씩. 이벤트 루프마다 하나(테스트가 루프를 새로 만든다).
_quota_locks: WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = WeakKeyDictionary()


def _quota_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _quota_locks.get(loop)
    if lock is None:
        lock = _quota_locks[loop] = asyncio.Lock()
    return lock


class TtsService:
    def __init__(
        self,
        repo: TtsRepository,
        journey: JourneyService,
        *,
        api_key: str | None,
        monthly_limit: int,
        user_daily_limit: int,
        cache_dir: str | Path,
        synth_fn: SynthFn | None = None,
        month_fn: Callable[[], str] = billing_month,
        today_fn: Callable[[], date] = today_kst,
        now_fn: Callable[[], datetime] = _utcnow,
        request_timeout: float = REQUEST_TIMEOUT_SECONDS,
    ) -> None:
        self.repo, self.journey = repo, journey
        self.api_key = (api_key or "").strip() or None
        self.monthly_limit, self.user_daily_limit = monthly_limit, user_daily_limit
        self.cache_dir = Path(cache_dir)
        self.synth_fn = synth_fn or self._google
        self.month_fn, self.today_fn, self.now_fn = month_fn, today_fn, now_fn
        self.request_timeout = request_timeout

    async def _cache_writable(self) -> bool:
        """캐시 디렉터리에 파일을 만들고 지울 수 있는가. 볼륨 권한이 틀렸거나 읽기 전용이면 False."""

        def probe() -> None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            marker = self.cache_dir / f".probe-{uuid.uuid4().hex}"
            marker.write_bytes(b"")
            marker.unlink()

        try:
            await asyncio.to_thread(probe)
        except OSError:
            logger.exception("훈독 TTS 캐시 디렉터리에 쓸 수 없어 AI 낭독을 끕니다")
            return False
        return True

    async def _enabled(self) -> bool:
        return self.api_key is not None and await self._cache_writable()

    async def _google(self, voice_name: str, text: str) -> bytes:
        assert self.api_key is not None
        return await synthesize_mp3(text, voice_name=voice_name, speaking_rate=SPEAKING_RATE, api_key=self.api_key)

    async def voices(self) -> TtsVoicesResponse:
        enabled = await self._enabled()
        limit_reached = enabled and await self.repo.month_chars(self.month_fn()) >= self.monthly_limit
        return TtsVoicesResponse(
            enabled=enabled,
            limit_reached=limit_reached,
            default_voice=DEFAULT_VOICE,
            voices=[
                TtsVoice(id=voice_id, label=spec.label, description=spec.description)  # type: ignore[arg-type]
                for voice_id, spec in VOICES.items()
            ],
        )

    async def _check(self, voice: str) -> VoiceSpec:
        spec = VOICES.get(voice)
        if spec is None:
            raise TtsError(422, "TTS_INVALID_VOICE", "지원하지 않는 목소리예요")
        if not await self._enabled():
            raise TtsError(503, "TTS_DISABLED", "AI 낭독이 아직 준비되지 않았어요")
        return spec

    @staticmethod
    def _not_found() -> TtsError:
        return TtsError(404, "TTS_SOURCE_NOT_FOUND", "읽을 본문을 찾을 수 없어요")

    async def chunk_audio(self, chunk_id: str, voice: str, user_id: uuid.UUID) -> TtsAudio:
        """원문 뷰 단락 1개. full_text 허용 저작물만."""
        spec = await self._check(voice)
        text = await self.journey.chunk_display_text(chunk_id)
        if not text:
            raise self._not_found()
        return await self._audio(voice, spec, text, user_id)

    async def reading_audio(self, reading_id: uuid.UUID, paragraph: int, voice: str, user_id: uuid.UUID) -> TtsAudio:
        """오늘 훈독(/hoondok/read) 말씀의 단락 1개. 편성 말씀(daily_readings) 또는 내 정성 말씀(jeongseong_readings)."""
        spec = await self._check(voice)
        body = await self._reading_body(reading_id, user_id)
        paragraphs = split_paragraphs(body) if body else []
        if not 0 <= paragraph < len(paragraphs):
            raise self._not_found()
        return await self._audio(voice, spec, paragraphs[paragraph], user_id)

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
        reading, period = found
        # 정성 말씀은 본인 것만, 화면과 같이 진행 중 기간의 오늘 말씀만, 정성 권리가 지금도 허용된 저작물만.
        today = self.today_fn()
        is_current = (
            period.status == "active"
            and reading.reading_date == today
            and today < period.started_on + timedelta(days=period.duration_days)
        )
        if period.user_id != user_id or not is_current:
            return None
        if reading.volume not in await self.journey.allowed("scope_jeongseong"):
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

    async def _reserve(self, voice: str, key: str, chars: int, user_id: uuid.UUID) -> uuid.UUID:
        """상한을 확인하고 글자 수를 먼저 적어 둔다. 커밋까지 한 락 안에서 — 동시 요청이 같은 옛 합계를 보지 않게."""
        async with _quota_lock():
            month = self.month_fn()
            if await self.repo.month_chars(month) + chars > self.monthly_limit:
                await self.repo.release()
                raise TtsError(429, "TTS_QUOTA_EXCEEDED", "이번 달 AI 낭독 한도에 도달했어요")
            since = self.now_fn() - USER_WINDOW
            if await self.repo.user_chars_since(user_id, since) + chars > self.user_daily_limit:
                await self.repo.release()
                raise TtsError(429, "TTS_USER_LIMIT_EXCEEDED", "오늘 AI 낭독을 많이 들었어요")
            usage = TtsUsage(month=month, voice=voice, chars=chars, cache_key=key, user_id=user_id, created_at=self.now_fn())
            usage_id = usage.id
            # 커밋하면 커넥션이 풀로 돌아간다 — 아래 Google 호출 동안 쥐고 있지 않는다.
            await self.repo.add_usage(usage)
            return usage_id

    async def _audio(self, voice: str, spec: VoiceSpec, raw_text: str, user_id: uuid.UUID) -> TtsAudio:
        text = normalize_for_speech(raw_text)
        if not text:
            raise self._not_found()
        key = cache_key(voice, text)
        cached = await self._read_cache(key)
        if cached is not None:
            await self.repo.release()
            return TtsAudio(cached, key, True)
        async with _KeyLock(key):
            # 락을 기다리는 동안 앞 요청이 만들었을 수 있다.
            cached = await self._read_cache(key)
            if cached is not None:
                await self.repo.release()
                return TtsAudio(cached, key, True)
            usage_id = await self._reserve(voice, key, len(text), user_id)
            try:
                async with asyncio.timeout(self.request_timeout):
                    content = await self.synth_fn(spec.name, text)
            except TtsUpstreamError as exc:
                # Google 이 과금했을 수 있는 만큼(성공한 조각 등)만 남긴다.
                await self.repo.settle_usage(usage_id, min(exc.billed_chars, len(text)))
                raise TtsError(502, "TTS_UPSTREAM_FAILED", "AI 낭독을 만들지 못했어요") from None
            except TimeoutError:
                # 어디까지 합성됐는지 모른다 — 예약을 그대로 둔다(덜 세는 쪽보다 더 세는 쪽).
                logger.warning("훈독 TTS 합성 시간 초과 (%s초)", self.request_timeout)
                raise TtsError(504, "TTS_TIMEOUT", "AI 낭독을 만드는 데 너무 오래 걸렸어요") from None
            if not content:
                raise TtsError(502, "TTS_UPSTREAM_FAILED", "AI 낭독을 만들지 못했어요")
            # 사용량은 이미 커밋됐다. 캐시 저장은 그 뒤다 — 기록 없이 캐시만 남는 경우가 없다.
            try:
                await self._write_cache(key, content)
            except OSError:
                # 볼륨 권한·디스크 부족이어도 이번 듣기는 막지 않는다. 다음 요청부터는 _enabled 가 기능을 끈다.
                logger.exception("훈독 TTS 캐시 저장 실패")
            return TtsAudio(content, key, False)
