"""PipelineState enum + ChatContext.pipeline_state 단위 테스트."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import EXPECTED_PRIOR, PipelineState
from src.chat.schemas import ChatRequest


class TestPipelineStateEnum:
    def test_default_is_init(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        assert ctx.pipeline_state == PipelineState.INIT

    def test_enum_members_present(self) -> None:
        members = {s.name for s in PipelineState}
        assert {
            "INIT",
            "INPUT_VALIDATED",
            "SESSION_READY",
            "EMBEDDED",
            "CACHE_CHECKED",
            "CACHE_HIT_TERMINATED",
            "RUNTIME_RESOLVED",
            "QUERY_REWRITTEN",
            "SEARCHED",
            "RERANKED",
            "GENERATED",
            "SAFETY_APPLIED",
            "PERSISTED",
            "STREAM_ABORTED",
        }.issubset(members)

    def test_expected_prior_covers_all_stages(self) -> None:
        # 11 Stage 가 모두 등록되어야 함
        assert {
            "InputValidationStage",
            "SessionStage",
            "EmbeddingStage",
            "CacheCheckStage",
            "RuntimeConfigStage",
            "QueryRewriteStage",
            "SearchStage",
            "RerankStage",
            "GenerationStage",
            "SafetyOutputStage",
            "PersistStage",
        }.issubset(set(EXPECTED_PRIOR.keys()))

    def test_pipeline_state_is_str_enum(self) -> None:
        # "PERSISTED" 등 string 값으로 직렬화 가능
        assert PipelineState.PERSISTED.value == "PERSISTED"
