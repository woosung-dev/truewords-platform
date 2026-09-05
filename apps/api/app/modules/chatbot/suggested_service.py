# 봇별 동적 추천 질문 칩 3개 생성 서비스. cron job (매일 03:30 KST) 진입점에서 호출.
"""SuggestedQuestionsService — 봇별 추천 질문 3개 생성.

흐름:
  1) ChatbotRepository.get_top_queries_for_bot() — 30 일 사용자 질문 top-N
  2) 봇의 search_tiers 에서 sources 추출 → RawQdrantClient.scroll() 로 RAG sample
  3) cold-start fallback — 30 일 질문이 N건 미만이면 RAG sample 만으로 생성
  4) Gemini generate_text() — JSON 출력 강제 ({"questions": [...]})
  5) ChatbotRepository.update_suggested_questions() 로 DB 저장

호출처:
  - apps/api/scripts/refresh_suggested_questions.py (cron entry)
  - 향후 admin "지금 갱신" 버튼 (옵션 E 확장 시)
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.modules.chatbot.models import ChatbotConfig
from app.modules.chatbot.repository import ChatbotRepository
from app.core.common.gemini import generate_text
from app.core.config import settings
from app.modules.qdrant import get_raw_client  # audit 2차 B-6 — src.qdrant_client deprecated shim 이관

logger = logging.getLogger(__name__)

# 30 일 질문이 N건 미만이면 cold-start 로 간주 (RAG sample 만 사용).
COLD_START_THRESHOLD = 5

# 추천 질문은 항상 정확히 3 개.
TARGET_COUNT = 3

# 30 일 질문 top-N — 너무 많이 보내면 prompt 길이 부담, 너무 적으면 패턴 부족.
TOP_QUERIES_LIMIT = 10

# RAG sample 크기 — Qdrant scroll 1 페이지면 충분.
RAG_SAMPLE_SIZE = 80


_SYSTEM_INSTRUCTION = (
    "당신은 종교 텍스트 기반 RAG AI 챗봇의 운영 보조자입니다. "
    "사용자가 자주 묻는 질문 패턴과 챗봇이 학습한 자료의 주제를 분석해, "
    "처음 화면에 노출할 추천 질문 3개를 한국어로 생성합니다.\n\n"
    "규칙:\n"
    "- 각 질문은 사용자 1인칭 어투(존댓말)로 자연스럽게 작성합니다.\n"
    "- 자료에 실제로 답이 있을 만한 구체적 질문만 만듭니다.\n"
    "- 같은 주제 반복 금지. 서로 다른 측면을 다루도록 분산합니다.\n"
    "- 길이는 한 문장, 30~60자 권장.\n"
    "- 답변은 반드시 JSON 한 덩어리로만 출력하세요. 형식: "
    '{"questions": ["...", "...", "..."]}'
)


def _extract_sources(search_tiers: dict[str, Any] | None) -> list[str]:
    """search_tiers JSONB 에서 source 식별자 union 추출. cascading + weighted 모두 대응."""
    if not search_tiers:
        return []
    sources: set[str] = set()
    for tier in search_tiers.get("tiers", []) or []:
        for s in tier.get("sources", []) or []:
            sources.add(str(s))
    for ws in search_tiers.get("weighted_sources", []) or []:
        s = ws.get("source")
        if s:
            sources.add(str(s))
    return sorted(sources)


async def _fetch_rag_sample(sources: list[str]) -> list[str]:
    """봇의 source 필터로 Qdrant scroll → chunk text 샘플 수집.

    title 우선 → 없으면 text 앞 120자. 빈 sources 면 전체 컬렉션에서 sample.
    """
    qdrant_filter: dict[str, Any] | None = None
    if sources:
        qdrant_filter = {
            "must": [{"key": "source", "match": {"any": sources}}]
        }

    client = get_raw_client()
    try:
        points, _next = await client.scroll(
            settings.collection_name,
            scroll_filter=qdrant_filter,
            with_payload=True,
            with_vectors=False,
            limit=RAG_SAMPLE_SIZE,
        )
    except Exception as exc:
        logger.warning("Qdrant scroll 실패 (sample empty): %r", exc)
        return []

    excerpts: list[str] = []
    seen: set[str] = set()
    for p in points:
        payload = p.payload or {}
        title = (payload.get("title") or "").strip()
        text = (payload.get("text") or "").strip()
        snippet = title or text[:120]
        if not snippet or snippet in seen:
            continue
        seen.add(snippet)
        excerpts.append(snippet)
    return excerpts


def _parse_questions(raw: str) -> list[str]:
    """Gemini 응답에서 questions 리스트 추출. 코드블록 ```json ... ``` 도 허용."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # 첫 줄 fence + 마지막 fence 제거
        lines = cleaned.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini JSON 파싱 실패: {exc}; raw={raw[:200]!r}") from exc
    questions = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(questions, list):
        raise ValueError(f"questions 필드 누락 또는 형식 오류: {raw[:200]!r}")
    cleaned_questions = [str(q).strip() for q in questions if str(q).strip()]
    return cleaned_questions[:TARGET_COUNT]


def _build_prompt(
    bot_name: str,
    top_queries: list[dict],
    rag_excerpts: list[str],
    *,
    cold_start: bool,
) -> str:
    parts = [f"챗봇 이름: {bot_name}", ""]
    if cold_start:
        parts.append(
            "최근 30 일 사용자 질문 데이터가 부족합니다. "
            "아래 자료 샘플만 보고 추천 질문 3 개를 생성하세요.\n"
        )
    else:
        parts.append("최근 30 일 자주 들어온 사용자 질문 (count desc):")
        for q in top_queries:
            parts.append(f"- ({q['count']}회) {q['query_text']}")
        parts.append("")
        parts.append("위 패턴을 반영하되, 동일 표현 그대로 복붙하지 말고 ")
        parts.append("자연스럽게 재구성합니다.\n")
    parts.append("자료(원문) 샘플 — 제목/본문 발췌:")
    for ex in rag_excerpts[:30]:
        parts.append(f"- {ex}")
    parts.append("")
    parts.append('출력 형식: {"questions": ["q1", "q2", "q3"]}')
    return "\n".join(parts)


class SuggestedQuestionsService:
    """봇별 추천 질문 생성 + DB 저장."""

    def __init__(self, repo: ChatbotRepository) -> None:
        self.repo = repo

    async def generate_for_bot(
        self,
        chatbot_id: str,
        *,
        days: int = 30,
    ) -> list[str]:
        """단일 봇 처리 — 생성 + DB 저장. 저장한 questions 리스트 반환.

        실패 시 예외 propagate. cron entry 가 봇별로 격리해 catch.
        """
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            raise ValueError(f"chatbot_id '{chatbot_id}' 없음")

        top_queries = await self.repo.get_top_queries_for_bot(
            chatbot_config_id=config.id,
            days=days,
            limit=TOP_QUERIES_LIMIT,
        )
        sources = _extract_sources(config.search_tiers)
        rag_excerpts = await _fetch_rag_sample(sources)

        cold_start = len(top_queries) < COLD_START_THRESHOLD
        if cold_start and not rag_excerpts:
            raise RuntimeError(
                f"질문/RAG 샘플 모두 비어있음 — bot={chatbot_id}, sources={sources}"
            )

        prompt = _build_prompt(
            bot_name=config.display_name,
            top_queries=top_queries,
            rag_excerpts=rag_excerpts,
            cold_start=cold_start,
        )
        raw = await generate_text(prompt, system_instruction=_SYSTEM_INSTRUCTION)
        questions = _parse_questions(raw)
        if len(questions) < TARGET_COUNT:
            raise RuntimeError(
                f"Gemini 가 {TARGET_COUNT}개 미만 생성: {questions}"
            )

        await self.repo.update_suggested_questions(config, questions)
        await self.repo.commit()
        logger.info(
            "추천 질문 갱신 완료 — bot=%s cold_start=%s questions=%s",
            chatbot_id,
            cold_start,
            questions,
        )
        return questions

    async def generate_for_active_bots(self, *, days: int = 30) -> dict[str, Any]:
        """활성 봇 모두 순회. 봇별 실패는 격리해 다음 봇 진행. summary 반환."""
        bots = await self.repo.list_active()
        succeeded: list[str] = []
        failed: list[dict[str, str]] = []
        for bot in bots:
            try:
                await self.generate_for_bot(bot.chatbot_id, days=days)
                succeeded.append(bot.chatbot_id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("추천 질문 갱신 실패 — bot=%s", bot.chatbot_id)
                failed.append({"chatbot_id": bot.chatbot_id, "error": repr(exc)})
        return {
            "total": len(bots),
            "succeeded": succeeded,
            "failed": failed,
        }


def _config_to_dict(config: ChatbotConfig) -> dict[str, Any]:
    """디버그 출력용. cron 결과 로그에 활용."""
    return {
        "chatbot_id": config.chatbot_id,
        "display_name": config.display_name,
        "suggested_at": config.suggested_at.isoformat() if config.suggested_at else None,
        "suggested_questions": list(config.suggested_questions or []),
    }
