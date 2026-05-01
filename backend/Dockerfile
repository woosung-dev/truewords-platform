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
RUN chown -R appuser:appuser /app

USER appuser

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

# Cloud Run: 단일 워커 (인스턴스 레벨 스케일링)
# 시작 시 alembic upgrade head 자동 적용 — 새 migration 이 코드와 함께 배포될 때
# DB schema 와의 동기화를 보장. dev-log 41 (incident 2026-04-25) 재발 방지.
# advisory lock (ALEMBIC_USE_ADVISORY_LOCK=true) 은 Cloud Run env 로 별도 toggle.
# NOTE: `uv` binary 는 builder stage 에만 있음 (runtime 에 미복사). PATH 우선이
#       /app/.venv/bin 이라 alembic / uvicorn 을 직접 호출.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8080"]
