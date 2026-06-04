# TrueWords Platform — 자주 쓰는 작업을 모아둔 Makefile
# 사용법: `make` (도움말) / `make <target>`
#
# 디렉터리: admin/ (Next.js 16 + pnpm), backend/ (FastAPI + uv)

.DEFAULT_GOAL := help
.PHONY: help \
        admin-dev admin-type admin-lint admin-test admin-test-watch admin-build admin-e2e admin-install \
        backend-dev backend-test backend-test-fast backend-lint backend-install backend-migrate backend-start \
        infra-up infra-down infra-logs infra-status infra-reset \
        verify verify-modal test-all type-check clean

# ============================================================
# 포트 오프셋 — 동시에 여러 프로젝트를 띄울 때 포트 충돌 방지
# 다른 프로젝트 repo 는 아래 기본값을 100/200/... 으로만 바꾸면
# 5개 포트(admin/backend/postgres/qdrant http·grpc)가 통째로 밀린다.
# truewords 는 0 유지 → 오프셋 0 이면 현재 동작과 완전히 동일.
#   일회성 override: make backend-start PORT_OFFSET=100
# ============================================================
PORT_OFFSET ?= 0
# backend = 기존 로컬 볼륨(backend_postgres_data / backend_qdrant_data, 9GB)을
# 그대로 재사용하기 위해 유지하는 이름. 다른 프로젝트는 자기 이름으로 override 한다.
COMPOSE_PROJECT_NAME ?= backend

ADMIN_PORT       := $(shell echo $$((3000 + $(PORT_OFFSET))))
BACKEND_PORT     := $(shell echo $$((8000 + $(PORT_OFFSET))))
POSTGRES_PORT    := $(shell echo $$((5432 + $(PORT_OFFSET))))
QDRANT_PORT      := $(shell echo $$((6333 + $(PORT_OFFSET))))
QDRANT_GRPC_PORT := $(shell echo $$((6334 + $(PORT_OFFSET))))

# docker compose 호출 — 프로젝트 이름 + 포트를 env 로 주입.
# COMPOSE_PROJECT_NAME 분리가 핵심: 컨테이너/볼륨/네트워크가 프로젝트별로
# 격리되어 다른 프로젝트와 데이터 볼륨이 섞이지 않는다.
COMPOSE := COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME) \
           POSTGRES_PORT=$(POSTGRES_PORT) \
           QDRANT_PORT=$(QDRANT_PORT) \
           QDRANT_GRPC_PORT=$(QDRANT_GRPC_PORT) \
           docker compose

# 오프셋이 0 이 아닐 때만 backend 접속 URL 을 로컬 오프셋 포트로 덮어쓴다.
# (0 이면 .env 를 그대로 존중 → 클라우드/Neon 테스트 흐름까지 현행 보존)
ifeq ($(PORT_OFFSET),0)
  BACKEND_ENV :=
else
  BACKEND_ENV := DATABASE_URL="postgresql+asyncpg://truewords:truewords@localhost:$(POSTGRES_PORT)/truewords" \
                 QDRANT_URL="http://localhost:$(QDRANT_PORT)" \
                 ADMIN_FRONTEND_URL="http://localhost:$(ADMIN_PORT)"
endif

# ============================================================
# 도움말
# ============================================================
help: ## 사용 가능한 명령 목록
	@echo "TrueWords Platform — make targets"
	@echo ""
	@echo "▶ 오늘 변경분 검증"
	@grep -E '^(verify|verify-modal):.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ Admin (Next.js 16)"
	@grep -E '^admin-[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ Backend (FastAPI)"
	@grep -E '^backend-[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ Local infra (Docker — PostgreSQL + Qdrant)"
	@grep -E '^infra-[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ 통합"
	@grep -E '^(test-all|type-check|clean):.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ 현재 포트 (PORT_OFFSET=$(PORT_OFFSET), project=$(COMPOSE_PROJECT_NAME))"
	@echo "  admin=$(ADMIN_PORT)  backend=$(BACKEND_PORT)  postgres=$(POSTGRES_PORT)  qdrant=$(QDRANT_PORT)/$(QDRANT_GRPC_PORT)"

# ============================================================
# 오늘 변경분 검증 — source-original-modal.tsx (highlight + .txt strip)
# ============================================================
verify: verify-modal admin-type ## 오늘 변경분 일괄 검증 (modal 단위 테스트 + admin 전체 타입체크)

verify-modal: ## 원문 보기 모달 단위 테스트만 (source-original-modal)
	@echo "▶ source-original-modal 단위 테스트 실행"
	@cd admin && pnpm vitest run src/test/source-original-modal.test.tsx

# ============================================================
# Admin (Next.js 16, pnpm)
# ============================================================
admin-dev: ## admin dev 서버 (기본 3000, PORT_OFFSET 반영 + API URL 자동 연결)
	@cd admin && PORT=$(ADMIN_PORT) NEXT_PUBLIC_API_URL=http://localhost:$(BACKEND_PORT) pnpm dev

admin-type: ## admin TypeScript 타입 체크 (tsc --noEmit)
	@cd admin && pnpm tsc --noEmit

admin-lint: ## admin ESLint
	@cd admin && pnpm lint

admin-test: ## admin Vitest 단위 테스트 1회 실행
	@cd admin && pnpm test

admin-test-watch: ## admin Vitest watch 모드
	@cd admin && pnpm test:watch

admin-build: ## admin 프로덕션 빌드
	@cd admin && pnpm build

admin-e2e: ## admin Playwright E2E (헤드리스)
	@cd admin && pnpm test:e2e

admin-install: ## admin 의존성 설치 (pnpm install)
	@cd admin && pnpm install

# ============================================================
# Backend (FastAPI, uv)
# ============================================================
backend-dev: ## backend dev 서버 (기본 8000, PORT_OFFSET 반영, --reload)
	@cd backend && $(BACKEND_ENV) uv run uvicorn main:app --host 0.0.0.0 --port $(BACKEND_PORT) --reload

backend-test: ## backend 전체 pytest (chunker_hierarchical 제외 — 메모리 정책)
	@cd backend && uv run pytest --ignore=tests/test_chunker_hierarchical.py

backend-test-fast: ## backend pytest fail-fast (-x, 첫 실패 즉시 중단)
	@cd backend && uv run pytest -x --ignore=tests/test_chunker_hierarchical.py

backend-lint: ## backend ruff lint (있을 때만)
	@cd backend && (uv run ruff check . 2>/dev/null || echo "ruff 미설정 — skip")

backend-install: ## backend 의존성 설치 (.env symlink + openpyxl 포함, worktree 정책)
	@cd backend && uv pip install -e ".[dev]" && uv pip install openpyxl
	@test -f backend/.env || ln -s ../.env backend/.env 2>/dev/null || true

backend-migrate: ## backend alembic 마이그레이션 적용 (upgrade head)
	@cd backend && $(BACKEND_ENV) uv run alembic upgrade head

backend-start: infra-up backend-migrate backend-dev ## 인프라 up → 마이그레이션 → dev 서버 (cold start 한 방)

# ============================================================
# Local infra — Docker Compose (PostgreSQL + Qdrant)
# backend/docker-compose.yml 의 postgres/qdrant 서비스만 사용. backend 서비스는
# 호스트(uvicorn)에서 직접 띄운다.
# ============================================================
infra-up: ## postgres + qdrant 컨테이너 기동 (백그라운드, healthy 까지 대기)
	@cd backend && $(COMPOSE) up -d --wait postgres qdrant

infra-down: ## postgres + qdrant 컨테이너 정지 (볼륨은 보존)
	@cd backend && $(COMPOSE) down

infra-logs: ## postgres + qdrant 로그 follow (Ctrl+C 로 종료)
	@cd backend && $(COMPOSE) logs -f postgres qdrant

infra-status: ## 컨테이너 상태 + 포트 binding 확인
	@cd backend && $(COMPOSE) ps

infra-reset: ## ⚠️ 컨테이너 + 데이터 볼륨까지 전부 삭제 (postgres/qdrant 데이터 초기화)
	@echo "⚠️  postgres_data, qdrant_data 볼륨까지 삭제됩니다. 5초 후 진행 (Ctrl+C 로 취소)..."
	@sleep 5
	@cd backend && $(COMPOSE) down -v

# ============================================================
# 통합
# ============================================================
test-all: admin-test backend-test ## admin + backend 단위 테스트 일괄 실행

type-check: admin-type ## 타입 체크 (현재 admin TypeScript만 — backend는 mypy 미설정)

clean: ## 빌드 산출물 정리 (.next, __pycache__, .pytest_cache)
	@echo "▶ admin/.next 삭제"
	@rm -rf admin/.next
	@echo "▶ Python 캐시 삭제"
	@find backend -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
	@find backend -type d -name ".pytest_cache" -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "▶ 완료"
