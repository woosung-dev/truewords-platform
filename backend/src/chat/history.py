"""멀티턴 대화 이력 윈도우 선택 — 토큰 예산 기반 절삭 순수 함수."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.chat.models import SessionMessage

# 생성 프롬프트 주입용 기본 예산. ORConvQA w=6 피크 + Pinecone k=6 근거로
# 최근 12메시지(≈6턴) 상한, 토큰 ~1200 이중 방어.
DEFAULT_TOKEN_BUDGET = 1200
DEFAULT_MAX_MESSAGES = 12
# 이전 assistant 답변은 전문 대신 앞부분만 — 검색/생성 노이즈 및 토큰 절감.
DEFAULT_ASSISTANT_TRUNCATE_CHARS = 400


def estimate_tokens(text: str) -> int:
    """한국어 Gemini 토큰 근사치 (약 1.7자/토큰 → 보수적으로 len//2)."""
    return max(1, len(text) // 2)


def select_history_window(
    messages: list[SessionMessage],
    *,
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    max_messages: int = DEFAULT_MAX_MESSAGES,
    assistant_truncate_chars: int = DEFAULT_ASSISTANT_TRUNCATE_CHARS,
) -> list[tuple[str, str]]:
    """이력에서 프롬프트 주입용 (role, content) 윈도우를 선택한다.

    - 최신 → 과거 역순으로 누적하다 token_budget/max_messages 초과 시 중단.
    - assistant 발화는 assistant_truncate_chars 로 truncate ("…" 접미).
    - 반환은 다시 시간 오름차순 (오래된 → 최신). role 은 소문자 문자열.
    """
    window: list[tuple[str, str]] = []
    spent = 0
    for msg in reversed(messages):
        content = (msg.content or "").strip()
        if not content:
            continue
        role = msg.role.value.lower() if hasattr(msg.role, "value") else str(msg.role).lower()
        if role == "assistant" and len(content) > assistant_truncate_chars:
            content = content[:assistant_truncate_chars] + "…"
        # token_count 는 truncate 전 전체 길이 기준이라 truncate 후엔 부정확 —
        # 항상 truncate 된 텍스트 기준 즉석 추정으로 통일한다.
        cost = estimate_tokens(content)
        if window and (spent + cost > token_budget or len(window) >= max_messages):
            break
        window.append((role, content))
        spent += cost
    window.reverse()
    return window
