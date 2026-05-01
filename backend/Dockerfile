# === Stage 0: model-cache ===
# PR 5: BGE Cross-encoder 모델 사전 다운로드.
# Cloud Run cold start 시 모델 다운로드 회피 (~1.1GB×2). 레이어 캐시 활용.
# 모델 변경 없으면 재빌드 시 캐시 hit → 다운로드 skip.
FROM python:3.12-slim AS model-cache

RUN pip install --no-cache-dir "huggingface_hub>=0.25,<1.0"

# cache_dir 가 곧 HF "hub" 디렉토리. 런타임에서 $HF_HOME/hub 로 매핑.
RUN mkdir -p /cache/hub && python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('BAAI/bge-reranker-v2-m3', cache_dir='/cache/hub'); \
snapshot_download('dragonkue/bge-reranker-v2-m3-ko', cache_dir='/cache/hub'); \
print('[model-cache] BGE-base + BGE-ko 다운로드 완료');\
"


# === Stage 1: builder ===
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /uvx /bin/

WORKDIR /app

# 의존성 캐시 레이어 — pyproject.toml + uv.lock 먼저 복사
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 소스 코드 복사 + 프로젝트 설치
COPY . .
RUN uv sync --frozen --no-dev

# §22.7 N4: 빌드 시점의 alembic head 를 artifact 로 고정.
# 런타임에 ALEMBIC_EXPECTED_HEAD env 가 미설정일 때 파일에서 fallback 읽음.
RUN uv run alembic heads | head -1 | awk '{print $1}' > /app/ALEMBIC_EXPECTED_HEAD \
 && echo "[build] ALEMBIC_EXPECTED_HEAD=$(cat /app/ALEMBIC_EXPECTED_HEAD)"

# === Stage 2: runtime ===
FROM python:3.12-slim

WORKDIR /app

# 보안: 비루트 사용자
RUN adduser --disabled-password --no-create-home appuser

# builder에서 전체 앱 복사 (venv 포함)
COPY --from=builder /app /app

# PR 5: BGE 모델 캐시를 runtime 에 베이크인.
# HF_HOME=/app/.cache/huggingface 이므로 hub 디렉토리는 그 아래 hub/.
# sentence-transformers 가 BGEReranker 첫 호출 시 네트워크 fetch 없이 즉시 로드.
COPY --from=model-cache /cache/hub /app/.cache/huggingface/hub
RUN chown -R appuser:appuser /app/.cache

USER appuser

# PR 5: HF 캐시 위치 명시. sentence-transformers / huggingface_hub 둘 다 인식.
ENV HF_HOME=/app/.cache/huggingface
ENV HUGGINGFACE_HUB_CACHE=/app/.cache/huggingface/hub
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

# Cloud Run: 단일 워커 (인스턴스 레벨 스케일링)
# 시작 시 alembic upgrade head 자동 적용 — 새 migration 이 코드와 함께 배포될 때
# DB schema 와의 동기화를 보장. dev-log 41 (incident 2026-04-25) 재발 방지.
# advisory lock (ALEMBIC_USE_ADVISORY_LOCK=true) 은 Cloud Run env 로 별도 toggle.
# NOTE: `uv` binary 는 builder stage 에만 있음 (runtime 에 미복사). PATH 우선이
#       /app/.venv/bin 이라 alembic / uvicorn 을 직접 호출.
# Cloud Run 메모리 4GB↑ 권장 (BGE 모델 로드 + uvicorn 워커 — docs/06_devops/cloud-run-resources.md)
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8080"]
