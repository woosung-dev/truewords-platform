"""Query Rewriter 모듈. 사용자 구어체 질문을 종교 용어 기반으로 재작성하여 검색 recall을 개선한다."""

import asyncio
import logging

from src.common.gemini import MODEL_GENERATE, generate_text
from src.common.log_helpers import query_fingerprint

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

# 멀티턴 condense — 대화 이력이 입력에 포함돼 출력이 길어질 수 있어 별도 상한.
CONDENSE_TIMEOUT_SECONDS = 2.5

# 멀티턴 후속 질문 → 독립 질문(standalone question) 재작성 프롬프트.
# "이미 독립적이면 그대로 출력" 규칙으로 과잉 재작성(의도 왜곡)을 방어한다.
CONDENSE_SYSTEM_PROMPT = """당신은 대화형 검색을 위한 질문 재작성 전문가입니다.
이전 대화와 후속 질문이 주어지면, 후속 질문을 이전 대화 없이도 누구나 이해할 수 있는
독립적인 질문 한 문장으로 재작성하세요.

규칙:
1. "그것", "그럼", "아까 말한" 같은 대명사·지시어를 이전 대화의 실제 대상으로 치환
2. 질문이 이미 독립적이면 (이전 대화 참조가 없으면) 원문을 그대로 출력
3. 질문의 의도와 범위를 바꾸지 않음 — 새로운 내용을 추가하지 않음
4. 재작성된 질문만 출력하고 설명은 추가하지 않음

예시:
이전 대화:
사용자: 자녀를 효자로 기르는 자세는 무엇인가요?
도우미: 참사랑을 중심한 심정 교육이 중요합니다…
후속 질문: 그럼 그것을 가정에서 어떻게 실천하나요?
출력: 자녀를 효자로 기르기 위한 참사랑 중심의 심정 교육을 가정에서 어떻게 실천하나요?
"""

# condense + 종교 용어 변환 결합 프롬프트 — 봇의 query_rewrite_enabled=True 인
# 후속 턴에서 LLM 1회 호출로 두 변환을 동시에 수행 (순차 2회 호출 지연 회피).
CONDENSE_WITH_TERMS_SYSTEM_PROMPT = (
    CONDENSE_SYSTEM_PROMPT
    + """
추가 규칙 — 재작성 시 아래 종교 용어를 자연스럽게 반영하세요:
- 참부모님(문선명·한학자 총재), 원리강론, 천일국(하나님의 나라), 참사랑,
  하늘 부모님(하나님), 훈독회, 축복(결혼 축복 의식), 탕감, 복귀, 창조목적
"""
)


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
            # audit 2차 S-5: 원문 대신 fingerprint (PII 차단).
            logger.warning(
                "query_rewriter: LLM이 빈 응답 반환, 원본 쿼리 사용 | query=%s",
                query_fingerprint(query),
            )
            return query

        logger.info(
            "query_rewriter: 재작성 성공 | original=%s rewritten=%s",
            query_fingerprint(query),
            query_fingerprint(stripped),
        )
        return stripped

    except asyncio.TimeoutError:
        logger.warning(
            "query_rewriter: 타임아웃 (%.1fs 초과), 원본 쿼리 사용 | query=%s",
            REWRITE_TIMEOUT_SECONDS,
            query_fingerprint(query),
        )
        return query

    except Exception as exc:
        logger.warning(
            "query_rewriter: LLM 호출 실패, 원본 쿼리 사용 | query=%s error=%s",
            query_fingerprint(query),
            exc,
        )
        return query


# 멀티턴 이력 role 라벨 (condense 프롬프트 표기용 — 프롬프트 예시와 동일 표기).
_CONDENSE_ROLE_LABELS = {"user": "사용자", "assistant": "도우미"}


async def condense_query(
    query: str,
    history: list[tuple[str, str]],
    *,
    term_rewrite: bool = False,
) -> str:
    """멀티턴 후속 질문을 이력 기반 독립 질문(standalone question)으로 재작성한다.

    검색 전용 — 생성 단계는 원본 질문 + 원본 이력을 계속 사용한다 (업계 표준
    CondensePlusContext 이원 구조). term_rewrite=True 면 종교 용어 변환까지
    같은 LLM 호출에서 결합 수행한다.

    rewrite_query 와 동일한 graceful degradation: 이력 없음 / 실패 / 타임아웃 /
    빈 응답 → 원본 쿼리 반환.
    """
    if not history:
        return query
    history_lines = "\n".join(
        f"{_CONDENSE_ROLE_LABELS.get(role, role)}: {content}" for role, content in history
    )
    prompt = f"이전 대화:\n{history_lines}\n\n후속 질문: {query}\n출력:"
    system_prompt = CONDENSE_WITH_TERMS_SYSTEM_PROMPT if term_rewrite else CONDENSE_SYSTEM_PROMPT
    try:
        condensed = await asyncio.wait_for(
            generate_text(
                prompt=prompt,
                system_instruction=system_prompt,
                model=MODEL_GENERATE,
            ),
            timeout=CONDENSE_TIMEOUT_SECONDS,
        )
        stripped = condensed.strip()
        if not stripped:
            logger.warning(
                "condense_query: LLM이 빈 응답 반환, 원본 쿼리 사용 | query=%s",
                query_fingerprint(query),
            )
            return query
        logger.info(
            "condense_query: 재작성 성공 | original=%s condensed=%s",
            query_fingerprint(query),
            query_fingerprint(stripped),
        )
        return stripped
    except asyncio.TimeoutError:
        logger.warning(
            "condense_query: 타임아웃 (%.1fs 초과), 원본 쿼리 사용 | query=%s",
            CONDENSE_TIMEOUT_SECONDS,
            query_fingerprint(query),
        )
        return query
    except Exception as exc:
        logger.warning(
            "condense_query: LLM 호출 실패, 원본 쿼리 사용 | query=%s error=%s",
            query_fingerprint(query),
            exc,
        )
        return query
