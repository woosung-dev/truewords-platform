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

# === Stage 2: runtime ===
FROM python:3.12-slim

WORKDIR /app

# 보안: 비루트 사용자
RUN adduser --disabled-password --no-create-home appuser

# builder에서 전체 앱 복사 (venv 포함)
COPY --from=builder /app /app

USER appuser

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

# Cloud Run: 단일 워커 (인스턴스 레벨 스케일링)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
