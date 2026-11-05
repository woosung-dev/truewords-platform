"""7일 정성 Service (읽기 정성 1a, 계획 v2.1 §5).

- 진행은 저장하지 않고 완료 행에서 계산한다. 읽은 날의 원본은 `read_dates` 하나다(1b 에서 다시 보기 날을 더한다).
- run 은 날짜로 자동 전환하지 않는다. 마지막 장 완료 트랜잭션에서 completed, 그만하기에서 abandoned.
- 정성 기간(jeongseong_periods)과의 "진행 중 하나" 규칙은 사용자 행 잠금 뒤 두 테이블을 확인해 지킨다.
- 장 본문은 원문 뷰(API-HD-016)와 같은 display_text 규칙으로 만든다 — 형광펜 오프셋이 그대로 맞는다.
"""

import uuid
from collections.abc import Callable, Iterable
from datetime import date, timedelta

from fastapi import status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import today_kst, utcnow
from app.core.config import settings
from app.modules.hoondok.display_text import PAGE_SIZE, to_display_text
from app.modules.hoondok.exceptions import PathError
from app.modules.hoondok.journey_schemas import WordChunk
from app.modules.hoondok.models import ContentRight, PathRun, PathStepCompletion, ReadingPath, ReadingPathStep
from app.modules.hoondok.paths_repository import PathRepository
from app.modules.hoondok.paths_schemas import (
    PathRunCurrentResponse,
    PathRunFinishRequest,
    PathRunStart,
    PathRunView,
    PathStepCompleteRequest,
    PathStepCompleteResponse,
    PathStepCompletionView,
    PathStepContentResponse,
    PathStepState,
    PathStepSummary,
    ReadingPathListResponse,
    ReadingPathSummary,
    ReadingPathTier,
)
from app.modules.hoondok.repository import MissionLogRepository
from app.modules.hoondok.service import JeongseongService
from app.modules.qdrant import RawQdrantClient
from app.modules.qdrant.filters import build_filter, field_match, field_range
from app.modules.search.exceptions import SearchFailedError
from app.modules.search.hybrid import point_to_search_result

# 한 장에서 읽어 올 청크 상한 — 시드는 15분(약 7,500자) 기준이라 이보다 훨씬 작다
MAX_STEP_CHUNKS = 200


# --- 순수 계산 -------------------------------------------------------------------


def read_dates(completions: Iterable[PathStepCompletion]) -> set[date]:
    """읽은 날의 단일 원본. gap_days·이번 주 점이 모두 이 함수만 쓴다. (1b: passage_revisits.shown_on 합집합)"""
    return {c.completed_on for c in completions}


def run_end_on(run: PathRun) -> date:
    """끝나는 날 = 시작일 + 기간 − 1 + 늘린 날."""
    return run.started_on + timedelta(days=run.duration_days - 1 + run.extension_days)


def gap_days(dates: set[date], started_on: date, today: date) -> int:
    """마지막으로 읽은 날과 오늘 사이의 빈 날 수. 읽은 적이 없으면 시작 전날을 마지막 날로 본다.

    [가정] 시작하고 한 번도 읽지 않은 날도 빈 날로 센다(시작 당일 0, 이튿날 1).
    """
    last = max(dates) if dates else started_on - timedelta(days=1)
    return max(0, (today - last).days - 1)


def week_read_dates(dates: set[date], today: date) -> list[date]:
    """이번 주(일요일 시작) 일요일 ~ 오늘 사이에 읽은 날."""
    week_start = today - timedelta(days=(today.weekday() + 1) % 7)
    return sorted(d for d in dates if week_start <= d <= today)


def is_open(right: ContentRight | None) -> bool:
    """정성 장 권리 — 원문 보기와 정성 이용을 모두 허락한 저작물만."""
    return right is not None and right.status == "allowed" and right.scope_full_text and right.scope_jeongseong


def step_states(
    steps: list[ReadingPathStep],
    done: set[int],
    rights: dict[str, ContentRight],
    active: bool,
) -> dict[int, PathStepState]:
    """장 상태. next 는 완료 안 된·권리 열린 가장 작은 day_index(진행 중일 때만)."""
    states: dict[int, PathStepState] = {}
    next_found = False
    for step in steps:
        if step.day_index in done:
            states[step.day_index] = "done"
        elif not is_open(rights.get(step.volume)):
            states[step.day_index] = "withdrawn"
        elif active and not next_found:
            states[step.day_index] = "next"
            next_found = True
        else:
            states[step.day_index] = "upcoming"
    return states


def _closed(message: str = "이 정성의 말씀은 지금 열 수 없어요") -> PathError:
    return PathError(status.HTTP_403_FORBIDDEN, "RIGHTS_CLOSED", message)


class PathService:
    def __init__(
        self,
        repo: PathRepository,
        missions: MissionLogRepository,
        jeongseong: JeongseongService,
        client: RawQdrantClient | None = None,
        today_fn: Callable[[], date] = today_kst,
    ) -> None:
        self.repo, self.missions, self.jeongseong = repo, missions, jeongseong
        self.client, self.today_fn = client, today_fn

    # --- 목록 ---------------------------------------------------------------------

    async def list_paths(self) -> ReadingPathListResponse:
        """발행된 정성 중 장 권리가 모두 열린 것만. 단계별 하루 평균 분을 함께 준다."""
        out: list[ReadingPathSummary] = []
        for path in await self.repo.list_published():
            steps = await self.repo.list_steps(path.id, path.version)
            if not steps:
                continue
            rights = await self.repo.list_rights({s.volume for s in steps})
            if not all(is_open(rights.get(s.volume)) for s in steps):
                continue
            tiers: dict[int, list[ReadingPathStep]] = {}
            for step in steps:
                tiers.setdefault(step.minutes_tier, []).append(step)
            out.append(
                ReadingPathSummary(
                    slug=path.slug,
                    title=path.title,
                    when_line=path.when_line,
                    book=path.book,
                    duration_days=path.duration_days,
                    tiers=[
                        ReadingPathTier(
                            minutes_tier=tier,  # type: ignore[arg-type]
                            estimated_minutes=round(sum(s.estimated_minutes for s in rows) / len(rows)),
                            total_steps=len(rows),
                        )
                        for tier, rows in sorted(tiers.items())
                    ],
                )
            )
        return ReadingPathListResponse(paths=out)

    # --- 시작 · 현재 · 그만하기 ---------------------------------------------------

    async def start(self, user_id: uuid.UUID, data: PathRunStart) -> PathRunCurrentResponse:
        run = await self._start(user_id, data.slug, data.minutes_tier, data.preferred_slot)
        return await self._response(run)

    async def _start(
        self,
        user_id: uuid.UUID,
        slug: str,
        minutes_tier: int,
        preferred_slot: str | None,
        finished: tuple[uuid.UUID, str] | None = None,
    ) -> PathRun:
        """새 run. finished=(run_id, action) 이면 같은 커밋에서 그 completed run 의 마침표 행동을 기록한다."""
        path = await self.repo.get_published_by_slug(slug)
        if path is None:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_NOT_FOUND", "정성을 찾을 수 없어요")
        steps = await self.repo.list_steps(path.id, path.version, minutes_tier)
        if not steps:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_NOT_FOUND", "이 분량의 정성은 준비되지 않았어요")
        rights = await self.repo.list_rights({s.volume for s in steps})
        if not all(is_open(rights.get(s.volume)) for s in steps):
            raise _closed()

        # 끝난 정성 기간은 먼저 completed 로 정리한다(이 정리는 따로 커밋될 수 있어 잠금 전에 한다).
        await self.jeongseong.active_period(user_id)
        # 사용자 행 잠금 뒤 두 테이블 확인 → INSERT → 커밋까지 잠금 유지. 409 로 끝나면 요청 세션이 닫히며 풀린다.
        await self.repo.lock_user(user_id)
        if await self.repo.get_active_run(user_id) is not None:
            raise PathError(status.HTTP_409_CONFLICT, "PATH_RUN_ACTIVE", "이미 드리고 있는 7일 정성이 있어요")
        if await self.jeongseong.repo.get_active(user_id) is not None:
            raise PathError(status.HTTP_409_CONFLICT, "JEONGSEONG_ACTIVE", "이미 드리고 있는 정성 기간이 있어요")

        run = PathRun(
            user_id=user_id,
            path_id=path.id,
            path_version=path.version,
            minutes_tier=minutes_tier,
            title=path.title,
            book=path.book,
            duration_days=path.duration_days,
            started_on=self.today_fn(),
            preferred_slot=preferred_slot,
        )
        self.repo.add(run)
        if finished is not None:
            previous = await self.repo.get_run(finished[0])
            if previous is not None and previous.user_id == user_id and previous.status == "completed":
                previous.finish_action = finished[1]
                self.repo.add(previous)
        try:
            await self.repo.commit()
        except IntegrityError:
            raise PathError(
                status.HTTP_409_CONFLICT, "PATH_RUN_ACTIVE", "이미 드리고 있는 7일 정성이 있어요"
            ) from None
        await self.repo.refresh(run)
        return run

    async def _current(self, user_id: uuid.UUID) -> PathRun | None:
        """진행 중 run, 또는 마침표 행동을 아직 고르지 않은 가장 최근 completed run."""
        run = await self.repo.get_latest_run(user_id)
        if run is None:
            return None
        if run.status == "active" or (run.status == "completed" and run.finish_action is None):
            return run
        return None

    async def get_current(self, user_id: uuid.UUID) -> PathRunCurrentResponse:
        run = await self._current(user_id)
        return PathRunCurrentResponse(run=None if run is None else await self._view(run))

    async def abandon(self, user_id: uuid.UUID) -> None:
        run = await self.repo.get_active_run(user_id)
        if run is None:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_RUN_NOT_FOUND", "진행 중인 7일 정성이 없어요")
        run.status = "abandoned"
        run.finished_at = utcnow()
        self.repo.add(run)
        await self.repo.commit()

    async def finish(self, user_id: uuid.UUID, data: PathRunFinishRequest) -> PathRunCurrentResponse:
        """마침표 화면의 다음 행동. next=다른 정성 시작, repeat=같은 정성 다시, rest=오늘 훈독으로."""
        run = await self._current(user_id)
        if run is None:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_RUN_NOT_FOUND", "마친 7일 정성이 없어요")
        if run.status != "completed":
            raise PathError(status.HTTP_409_CONFLICT, "PATH_RUN_NOT_COMPLETED", "아직 마치지 않은 정성이에요")
        if data.action == "rest":
            run.finish_action = "rest"
            self.repo.add(run)
            await self.repo.commit()
            return PathRunCurrentResponse(run=None)
        if data.action == "next":
            if not data.slug:
                raise PathError(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "PATH_SLUG_REQUIRED", "다음 정성을 골라 주세요"
                )
            slug = data.slug
        else:
            path = await self.repo.get_path(run.path_id)
            if path is None:
                raise PathError(status.HTTP_404_NOT_FOUND, "PATH_NOT_FOUND", "정성을 찾을 수 없어요")
            slug = path.slug
        new_run = await self._start(
            user_id, slug, run.minutes_tier, run.preferred_slot, finished=(run.id, data.action)
        )
        return await self._response(new_run)

    # --- 장 본문 · 완료 ---------------------------------------------------------------

    async def get_step(self, user_id: uuid.UUID, day_index: int) -> PathStepContentResponse:
        run = await self._current(user_id)
        if run is None:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_RUN_NOT_FOUND", "진행 중인 7일 정성이 없어요")
        steps = await self.repo.list_steps(run.path_id, run.path_version, run.minutes_tier)
        step = next((s for s in steps if s.day_index == day_index), None)
        if step is None:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_STEP_NOT_FOUND", "그 장을 찾을 수 없어요")
        rights = await self.repo.list_rights({s.volume for s in steps})
        done = {c.day_index for c in await self.repo.list_completions(run.id)}
        state = step_states(steps, done, rights, run.status == "active")[day_index]
        right = rights.get(step.volume)
        base = {
            "day_index": step.day_index,
            "title": step.title,
            "estimated_minutes": step.estimated_minutes,
            "volume": step.volume,
            "work_title": right.work_title if right is not None else None,
        }
        if not is_open(right):
            return PathStepContentResponse(status="withdrawn", state=state, chunks=[], **base)
        chunks = await self._chunks(step)
        if chunks is None:
            # 재적재로 범위가 어긋났다 — 다른 본문을 보이지 않고 닫힌 장으로 둔다.
            return PathStepContentResponse(status="withdrawn", state=state, chunks=[], **base)
        return PathStepContentResponse(status="available", state=state, chunks=chunks, **base)

    async def _chunks(self, step: ReadingPathStep) -> list[WordChunk] | None:
        """장 범위의 청크를 원문 뷰와 같은 display_text 로. 양끝 chunk_id 가 다르면 None."""
        if self.client is None:
            raise SearchFailedError("훈독 원문 조회 실패")
        count = step.end_chunk_index - step.start_chunk_index + 1
        if count <= 0 or count > MAX_STEP_CHUNKS:
            return None
        # 원문 뷰는 페이지 첫 청크가 아니면 바로 앞 청크와의 겹침을 잘라낸다 — 같은 규칙을 쓰려고 앞 청크도 읽는다.
        lo = step.start_chunk_index - 1 if step.start_chunk_index % PAGE_SIZE else step.start_chunk_index
        try:
            points, _ = await self.client.scroll(
                settings.collection_name,
                scroll_filter=build_filter(
                    must=[
                        field_match("volume", step.volume),
                        field_range("chunk_index", gte=lo, lte=step.end_chunk_index),
                    ]
                ),
                limit=step.end_chunk_index - lo + 1,
                with_vectors=False,
            )
        except Exception:
            raise SearchFailedError("훈독 원문 조회 실패") from None
        by_index = {r.chunk_index: r for r in (point_to_search_result(p) for p in points)}
        first, last = by_index.get(step.start_chunk_index), by_index.get(step.end_chunk_index)
        if first is None or last is None or first.chunk_id != step.start_chunk_id or last.chunk_id != step.end_chunk_id:
            return None
        out: list[WordChunk] = []
        for index in range(step.start_chunk_index, step.end_chunk_index + 1):
            current = by_index.get(index)
            if current is None:
                return None
            previous = by_index.get(index - 1) if index % PAGE_SIZE else None
            out.append(
                WordChunk(
                    chunk_id=current.chunk_id,
                    chunk_index=index,
                    text=current.text,
                    display_text=to_display_text(previous.text if previous else None, current.text),
                )
            )
        return out

    async def complete(
        self, user_id: uuid.UUID, day_index: int, data: PathStepCompleteRequest
    ) -> PathStepCompleteResponse:
        """장 완료 + 그날 read 미션을 한 트랜잭션에. 순서: 같은 장 재요청 200 → 오늘 다른 장 409 → 순서 밖 409."""
        run = await self._current(user_id)
        if run is None:
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_RUN_NOT_FOUND", "진행 중인 7일 정성이 없어요")
        run_id = run.id
        steps = await self.repo.list_steps(run.path_id, run.path_version, run.minutes_tier)
        if not any(s.day_index == day_index for s in steps):
            raise PathError(status.HTTP_404_NOT_FOUND, "PATH_STEP_NOT_FOUND", "그 장을 찾을 수 없어요")
        completions = await self.repo.list_completions(run_id)
        existing = next((c for c in completions if c.day_index == day_index), None)
        if existing is not None:
            return await self._complete_response(run, existing)
        if run.status != "active":
            raise PathError(status.HTTP_409_CONFLICT, "PATH_RUN_NOT_ACTIVE", "이미 마친 정성이에요")
        today = self.today_fn()
        if any(c.completed_on == today for c in completions):
            raise PathError(status.HTTP_409_CONFLICT, "ALREADY_READ_TODAY", "오늘은 이미 한 장을 읽었어요")
        rights = await self.repo.list_rights({s.volume for s in steps})
        done = {c.day_index for c in completions}
        states = step_states(steps, done, rights, active=True)
        if states[day_index] != "next":
            raise PathError(status.HTTP_409_CONFLICT, "STEP_OUT_OF_ORDER", "다음 장부터 차례로 읽어요")

        completion = PathStepCompletion(
            run_id=run_id, day_index=day_index, mode=data.mode, completed_on=today, note=data.note
        )
        self.repo.add(completion)
        await self.missions.upsert_read_ignore(user_id, today)
        # 남은 장(완료 안 됨·권리 열림)이 이 장뿐이면 같은 트랜잭션에서 마친다.
        remaining = [d for d, state in states.items() if state in ("next", "upcoming") and d != day_index]
        if not remaining:
            run.status = "completed"
            run.finished_at = utcnow()
            self.repo.add(run)
        try:
            await self.repo.commit()
        except IntegrityError:
            # 동시 요청 — 같은 장이면 기존 값을 돌려주고, 오늘 다른 장이 먼저 들어갔으면 409.
            fresh_run = await self.repo.get_latest_run(user_id)
            rows = await self.repo.list_completions(run_id)
            again = next((c for c in rows if c.day_index == day_index), None)
            if again is not None and fresh_run is not None:
                return await self._complete_response(fresh_run, again)
            raise PathError(
                status.HTTP_409_CONFLICT, "ALREADY_READ_TODAY", "오늘은 이미 한 장을 읽었어요"
            ) from None
        await self.repo.refresh(completion)
        return await self._complete_response(run, completion)

    async def _complete_response(self, run: PathRun, completion: PathStepCompletion) -> PathStepCompleteResponse:
        return PathStepCompleteResponse(
            completion=PathStepCompletionView(
                day_index=completion.day_index,
                mode=completion.mode,  # type: ignore[arg-type]
                completed_on=completion.completed_on,
                note=completion.note,
            ),
            run=await self._view(run),
        )

    # --- 응답 조립 -------------------------------------------------------------------

    async def _response(self, run: PathRun) -> PathRunCurrentResponse:
        return PathRunCurrentResponse(run=await self._view(run))

    async def _view(self, run: PathRun) -> PathRunView:
        today = self.today_fn()
        path: ReadingPath | None = await self.repo.get_path(run.path_id)
        steps = await self.repo.list_steps(run.path_id, run.path_version, run.minutes_tier)
        completions = {c.day_index: c for c in await self.repo.list_completions(run.id)}
        rights = await self.repo.list_rights({s.volume for s in steps})
        states = step_states(steps, set(completions), rights, run.status == "active")
        dates = read_dates(completions.values())
        end_on = run_end_on(run)
        return PathRunView(
            id=run.id,
            slug=path.slug if path is not None else "",
            title=run.title,
            book=run.book,
            duration_days=run.duration_days,
            minutes_tier=run.minutes_tier,  # type: ignore[arg-type]
            preferred_slot=run.preferred_slot,  # type: ignore[arg-type]
            status=run.status,  # type: ignore[arg-type]
            started_on=run.started_on,
            today=today,
            day_no=max(1, (today - run.started_on).days + 1),
            end_on=end_on,
            overdue=run.status == "active" and today > end_on,
            total_steps=len(steps),
            done_steps=len(completions),
            next_step=next((d for d, state in states.items() if state == "next"), None),
            read_today=today in dates,
            gap_days=gap_days(dates, run.started_on, today),
            week_read_dates=week_read_dates(dates, today),
            read_days=len(dates),
            finished_at=run.finished_at,
            steps=[
                PathStepSummary(
                    day_index=s.day_index,
                    title=s.title,
                    estimated_minutes=s.estimated_minutes,
                    state=states[s.day_index],
                    volume=s.volume,
                    start_chunk_index=s.start_chunk_index,
                    end_chunk_index=s.end_chunk_index,
                    completed_on=completions[s.day_index].completed_on if s.day_index in completions else None,
                    note=completions[s.day_index].note if s.day_index in completions else None,
                )
                for s in steps
            ],
        )
