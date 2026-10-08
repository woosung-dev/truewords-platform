"""도입 전 검증용 실험 경로 (기본 꺼짐).

`POST /admin/rag-trace` 의 overrides 로만 켠다. 운영 `/chat` 경로는 이 패키지를 부르지 않는다.
각 모듈은 순수 함수로 두어, 도입이 결정되면 운영 stage 에서 그대로 부를 수 있게 한다.

- c1_citation: 구절 조회(passage_lookup) + 사후 인용 게이트 + 근거 부족 거절 (Fanar-Sadiq 식)
- c2_decompose: 질의 분해 → 병렬 검색 → 앱 수준 RRF (Azure agentic retrieval 식)
- c3_wiki: 인용 앵커 용어 카드 주입 (Meta 전문가 에이전트 식)
"""


def result_key(volume: str, chunk_index: int) -> str:
    """후보 표와 같은 "volume:chunk_index" 키."""
    return f"{volume}:{chunk_index}"
