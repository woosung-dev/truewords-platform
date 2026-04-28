"""Query Rewriter 모듈. 사용자 구어체 질문을 종교 용어 기반으로 재작성하여 검색 recall을 개선한다."""

import asyncio
import logging

from src.common.gemini import MODEL_GENERATE, generate_text

logger = logging.getLogger(__name__)

# 쿼리 재작성 시스템 프롬프트 — 종교 용어 변환 가이드
REWRITE_SYSTEM_PROMPT = """당신은 통일교(통일원리) 종교 문헌 검색을 위한 쿼리 재작성 전문가입니다.
사용자의 구어체 질문을 아래 종교 용어와 개념을 반영하여 검색에 최적화된 문장으로 재작성하세요.

주요 종교 용어:
- 참부모님: 문선명 총재와 한학자 총재를 지칭하는 핵심 호칭
- 원리강론: 통일교의 핵심 교리서
- 천일국: 하나님의 나라, 이상세계를 지칭하는 개념
- 참사랑: 하나님의 사랑, 이타적이고 희생적인 사랑
- 하늘 부모님: 하나님을 지칭하는 통일교 고유 호칭
- 훈독회: 말씀을 읽고 나누는 모임, 가정교회 활동
- 축복: 참부모님이 주관하는 결혼 축복 의식
- 탕감: 과거 죄와 잘못을 보상하는 과정
- 복귀: 타락 이전의 에덴동산 상태로 돌아가는 섭리
- 창조목적: 하나님이 인간과 만물을 창조한 본래의 목적

재작성 규칙:
1. 구어체를 격식체 문어체로 변환
2. 관련 종교 용어를 자연스럽게 포함
3. 검색 의도를 명확히 드러내는 구체적 표현 사용
4. 원문의 핵심 의미는 반드시 보존
5. 재작성된 쿼리만 출력하고 설명은 추가하지 않음

예시:
입력: "축복이 뭐야?"
출력: "참부모님이 말씀하신 축복의 의미와 정의"

입력: "천국은 어떤 곳이야?"
출력: "천일국의 개념과 하나님 나라의 실현 방법"
"""

# LLM 호출 타임아웃 (초) — 검색 지연 최소화
REWRITE_TIMEOUT_SECONDS = 1.5


async def rewrite_query(query: str, *, enabled: bool = True) -> str:
    """사용자 쿼리를 종교 용어 기반으로 재작성한다.

    enabled=False 면 LLM 호출 없이 원본 즉시 반환 (chatbot-level 토글 일관성).
    LLM 호출 실패, 타임아웃, 빈 응답 시에도 원본 쿼리를 그대로 반환하여
    graceful degradation을 보장한다.

    Args:
        query: 사용자 원본 쿼리 문자열
        enabled: chatbot 의 query_rewrite_enabled 플래그. False 시 즉시 원본 반환.

    Returns:
        재작성된 쿼리 문자열. 비활성/실패 시 원본 쿼리 반환.
    """
    if not enabled:
        return query
    try:
        rewritten = await asyncio.wait_for(
            generate_text(
                prompt=query,
                system_instruction=REWRITE_SYSTEM_PROMPT,
                model=MODEL_GENERATE,
            ),
            timeout=REWRITE_TIMEOUT_SECONDS,
        )

        # 빈 응답이면 원본 반환
        stripped = rewritten.strip()
        if not stripped:
            logger.warning("query_rewriter: LLM이 빈 응답 반환, 원본 쿼리 사용 | query=%r", query)
            return query

        logger.info("query_rewriter: 재작성 성공 | original=%r rewritten=%r", query, stripped)
        return stripped

    except asyncio.TimeoutError:
        logger.warning(
            "query_rewriter: 타임아웃 (%.1fs 초과), 원본 쿼리 사용 | query=%r",
            REWRITE_TIMEOUT_SECONDS,
            query,
        )
        return query

    except Exception as exc:
        logger.warning("query_rewriter: LLM 호출 실패, 원본 쿼리 사용 | query=%r error=%s", query, exc)
        return query
