"""RAGAS 4메트릭 임계값 회귀 테스트.

5건 fixture에 대해 RAGAS 평가를 실행하고 4메트릭 평균이 임계값(0.5)
이상인지 확인한다. baseline 회귀 가드 — 액션 1+2가 어떤 메트릭이라도
0.5 미만으로 떨어뜨리면 PR 단계에서 잡는다.

기본은 SKIP. CI/local 둘 다 다음 환경변수로 명시 활성화한다:

    RAGAS_RUN=1 GEMINI_API_KEY=... \\
        uv run --group eval pytest tests/test_ragas_thresholds.py -v

평가 LLM 은 임시로 Gemini 3.1 Pro (Anthropic 크레딧 충전 후 Claude Haiku 4.5 환원 예정).
docs/TODO.md "RAGAS 평가 LLM 환원" 참조.

이유:
- 무거운 의존성(ragas/langchain-anthropic) 설치가 dev 그룹이 아닌 eval 그룹.
- LLM 호출 비용 + 외부 API 의존성 → 491건 빠른 테스트와 분리.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

RAGAS_RUN = os.getenv("RAGAS_RUN") == "1"

# 5건 회귀 fixture — RAGAS dataset 호환 포맷 (sample_eval_pairs.py 출력 부분집합)
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "ragas_thresholds_seed.json"

# 메트릭별 최소 평균 (baseline 회귀 가드)
THRESHOLDS = {
    "faithfulness": 0.5,
    "context_precision": 0.5,
    "context_recall": 0.5,
    "answer_relevancy": 0.5,
}


pytestmark = pytest.mark.skipif(
    not RAGAS_RUN,
    reason="RAGAS_RUN=1 + ANTHROPIC_API_KEY + GEMINI_API_KEY 필요. eval 그룹 의존성 사전 설치 필수.",
)


def _load_fixture() -> list[dict]:
    if not FIXTURE_PATH.exists():
        pytest.skip(f"fixture 미존재: {FIXTURE_PATH}. sample_eval_pairs.py로 생성 후 5건 추출하세요.")
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def ragas_scores():
    """5건 fixture에 대한 RAGAS 점수. 모듈당 1회만 호출."""
    items_raw = _load_fixture()
    # eval_ragas.py와 동일 로직 (스크립트 import는 sys.path 의존성 회피 위해 직접 inline)
    from ragas import EvaluationDataset, SingleTurnSample, evaluate
    from ragas.metrics import (
        ContextPrecision,
        ContextRecall,
        Faithfulness,
        ResponseRelevancy,
    )
    from langchain_google_genai import (
        ChatGoogleGenerativeAI,
        GoogleGenerativeAIEmbeddings,
    )
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper

    if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

    samples = [
        SingleTurnSample(
            user_input=it["question"],
            retrieved_contexts=list(it.get("contexts", [])),
            response=it.get("answer", ""),
            reference=it.get("ground_truth", ""),
        )
        for it in items_raw
    ]
    dataset = EvaluationDataset(samples=samples)
    eval_llm = LangchainLLMWrapper(
        ChatGoogleGenerativeAI(model="gemini-2.5-pro", temperature=0)
    )
    eval_embeddings = LangchainEmbeddingsWrapper(
        GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
    )
    result = evaluate(
        dataset=dataset,
        metrics=[
            Faithfulness(),
            ContextPrecision(),
            ContextRecall(),
            ResponseRelevancy(strictness=1),
        ],
        llm=eval_llm,
        embeddings=eval_embeddings,
        show_progress=False,
    )
    return result.scores


@pytest.mark.parametrize("metric", list(THRESHOLDS.keys()))
def test_metric_above_threshold(ragas_scores, metric):
    values = []
    for row in ragas_scores:
        v = row.get(metric)
        try:
            fv = float(v) if v is not None else None
        except (TypeError, ValueError):
            fv = None
        if fv is not None and fv == fv:  # not NaN
            values.append(fv)
    assert values, f"{metric}: 유효 점수 0건. RAGAS 호출 실패 의심"
    mean = sum(values) / len(values)
    assert mean >= THRESHOLDS[metric], (
        f"{metric} mean={mean:.3f} < threshold={THRESHOLDS[metric]} "
        f"(n={len(values)}/{len(ragas_scores)})"
    )
