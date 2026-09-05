# === Stage 1: builder ===
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.10.4 /uv /uvx /bin/

WORKDIR /app

# 의존성 캐시 레이어 — pyproject.toml + uv.lock 먼저 복사
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 소스 코드 복사 + 프로젝트 설치
COPY apps/api/ .
RUN uv sync --frozen --no-dev

# §22.7 N4: 빌드 시점의 alembic head 를 artifact 로 고정.
# 런타임에 ALEMBIC_EXPECTED_HEAD env 가 미설정일 때 파일에서 fallback 읽음.
# (경로는 app/core/alembic_support/advisory_lock.py 가 /app/ALEMBIC_EXPECTED_HEAD 로 하드코딩)
#
# `uv run` 을 쓰지 않는다. uv run 은 실행 전 프로젝트를 sync 하는데 기본 그룹에
# dev 가 포함돼서, --no-dev 로 만든 venv 에 testcontainers/pytest-asyncio/openpyxl
# 이 되살아난다. venv 의 alembic 을 직접 부르면 그 경로가 없다.
# `test -s` 는 head 추출이 빈 파일을 남기고 통과하는 것을 막는다.
RUN /app/.venv/bin/alembic heads | head -1 | awk '{print $1}' > /app/ALEMBIC_EXPECTED_HEAD \
 && test -s /app/ALEMBIC_EXPECTED_HEAD \
 && echo "[build] ALEMBIC_EXPECTED_HEAD=$(cat /app/ALEMBIC_EXPECTED_HEAD)"

# === Stage 2: runtime ===
FROM python:3.12-slim

WORKDIR /app

# ── venv 레이어 (약 855MB) ──────────────────────────────────────────────────
# 소스와 한 레이어로 묶으면 안 된다. 예전에는 `COPY --from=builder /app /app`
# 한 줄이었는데, 소스 한 줄만 바뀌어도 venv 를 포함한 레이어 전체가 새로
# 생성됐다. VM 은 containerd image store 라 blob + snapshot 으로 이중 저장하므로
# 배포 1회당 실디스크 약 1.8GB 가 얹혔다 — 2026-08-30 실측에서 미사용 이미지
# 5개가 9GB 를 잠그고 있었고, 한 달 만에 디스크가 18G → 43G 로 늘었다.
#
# 분리가 성립하는 근거: uv.lock 이 프로젝트를 virtual 로 잡아 venv 의
# site-packages 에 설치하지 않는다(editable .pth 도 없다). uvicorn 은 WORKDIR
# 기준으로 app.main 을 import 하므로 venv 와 소스가 서로를 참조하지 않는다.
#
# 경로를 /app/.venv 에서 옮기면 안 된다 — venv 스크립트 shebang 이 절대경로다.
# adduser 보다 위에 둔다: 아래 레이어가 바뀌면 위 레이어의 chainID 가 다시
# 계산되므로, 가장 큰 레이어를 base 바로 위에 붙여 재사용을 최대로 만든다.
COPY --link --from=builder /app/.venv /app/.venv

# 보안: 비루트 사용자
RUN adduser --disabled-password --no-create-home appuser

# ── 소스 레이어 (약 4MB) — 배포마다 새로 생기는 부분 ────────────────────────
# 화이트리스트로 적는다. uvicorn.log(7.4MB) · uv.lock · tmp_eval 같은 빌드
# 컨텍스트 잔재가 런타임 이미지에 섞여 들어가지 않는다.
#
# scripts/ 는 선택이 아니라 필수다. VM cron 이 컨테이너 안에서 실행한다
# (infra/oracle-vm 의 refresh-questions.sh · cache-cleanup.sh · ops-check.sh 가
# `docker compose exec -T backend python scripts/*.py`). 빠지면 예약 작업 3개가
# 조용히 죽는다.
#
# 여기에 나열되지 않은 파일은 이미지에 들어가지 않는다. apps/api/ 최상위에
# 런타임이 필요로 하는 파일이 새로 생기면 이 목록에 추가해야 한다 — 누락은
# 기동 실패로 즉시 드러나고, Makefile 의 entrypoint 검증이 1차로 잡는다.
COPY --link --from=builder \
     /app/alembic.ini /app/pyproject.toml /app/ALEMBIC_EXPECTED_HEAD ./
COPY --link --from=builder /app/app     ./app
COPY --link --from=builder /app/alembic ./alembic
COPY --link --from=builder /app/scripts ./scripts

USER appuser

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

# Cloud Run: 단일 워커 (인스턴스 레벨 스케일링)
# 시작 시 alembic upgrade head 자동 적용 — 새 migration 이 코드와 함께 배포될 때
# DB schema 와의 동기화를 보장. dev-log 41 (incident 2026-04-25) 재발 방지.
# advisory lock (ALEMBIC_USE_ADVISORY_LOCK=true) 은 Cloud Run env 로 별도 toggle.
# NOTE: `uv` binary 는 builder stage 에만 있음 (runtime 에 미복사). PATH 우선이
#       /app/.venv/bin 이라 alembic / uvicorn 을 직접 호출.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8080"]
