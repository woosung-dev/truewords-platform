# TrueWords Platform — 자주 쓰는 작업을 모아둔 Makefile
# 사용법: `make` (도움말) / `make <target>`
#
# 디렉터리: admin/ (Next.js 16 + pnpm), backend/ (FastAPI + uv)

.DEFAULT_GOAL := help
# deploy-backend 의 `docker save | gzip -1 | ssh` 는 기본 sh 에서 마지막 ssh 의
# 종료 코드만 반영한다. 스트림이 중간에 잘려도 성공으로 보이므로 pipefail 을 켠다.
SHELL       := /bin/bash
.SHELLFLAGS := -o pipefail -c
# ~/.ssh/config의 Host 별칭.
ORACLE ?= truewords-oracle
TAG      ?= $(shell git rev-parse --short HEAD)
IMG      := truewords-backend:$(TAG)
ADMIN_IMG := truewords-admin:$(TAG)

.PHONY: help \
        admin-dev admin-type admin-lint admin-test admin-test-watch admin-build admin-e2e admin-install \
        backend-dev backend-test backend-test-fast backend-lint backend-install backend-migrate backend-start \
        infra-up infra-down infra-logs infra-status infra-reset \
        deploy-backend rollback-backend deploy-admin rollback-admin oracle-logs \
        ci ops-check cron-cache-cleanup cron-refresh-questions restore-drill \
        verify verify-modal test-all type-check clean

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
	@echo "▶ 배포 (Oracle Cloud VM)"
	@grep -E '^(deploy-backend|rollback-backend|deploy-admin|rollback-admin|oracle-logs):.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ CI / 운영 작업 (GitHub Actions 대체)"
	@grep -E '^(ci|ops-check|cron-cache-cleanup|cron-refresh-questions|restore-drill):.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "▶ 통합"
	@grep -E '^(test-all|type-check|clean):.*##' $(MAKEFILE_LIST) | awk -F':.*##' '{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

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
admin-dev: ## admin dev 서버 (http://localhost:3000)
	@cd admin && pnpm dev

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
backend-dev: ## backend dev 서버 (http://localhost:8000, --reload)
	@cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

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
	@cd backend && uv run alembic upgrade head

backend-start: infra-up backend-migrate backend-dev ## 인프라 up → 마이그레이션 → dev 서버 (cold start 한 방)

# ============================================================
# Local infra — Docker Compose (PostgreSQL + Qdrant)
# backend/docker-compose.yml 의 postgres/qdrant 서비스만 사용. backend 서비스는
# 호스트(uvicorn)에서 직접 띄운다.
# ============================================================
infra-up: ## postgres + qdrant 컨테이너 기동 (백그라운드, healthy 까지 대기)
	@cd backend && docker compose up -d --wait postgres qdrant

infra-down: ## postgres + qdrant 컨테이너 정지 (볼륨은 보존)
	@cd backend && docker compose down

infra-logs: ## postgres + qdrant 로그 follow (Ctrl+C 로 종료)
	@cd backend && docker compose logs -f postgres qdrant

infra-status: ## 컨테이너 상태 + 포트 binding 확인
	@cd backend && docker compose ps

infra-reset: ## ⚠️ 컨테이너 + 데이터 볼륨까지 전부 삭제 (postgres/qdrant 데이터 초기화)
	@echo "⚠️  postgres_data, qdrant_data 볼륨까지 삭제됩니다. 5초 후 진행 (Ctrl+C 로 취소)..."
	@sleep 5
	@cd backend && docker compose down -v

# ============================================================
# Oracle Cloud VM 배포
# ============================================================
deploy-backend: ## Oracle Cloud ARM VM backend 배포 (빌드·검증·전송·무중단 교체).
	@# 배포는 사람이 VM 을 들여다보는 몇 안 되는 순간이다. 예약 작업이 조용히
	@# 죽어 있으면 여기서라도 눈에 들어오게 한다. 배포를 막지는 않는다 —
	@# 백업이 낡았다고 배포를 못 하게 하는 건 인과가 뒤집힌 것이다.
	@$(MAKE) --no-print-directory ops-check || echo "⚠️  ops-check 위반 있음 — 배포는 계속합니다. 위 DETAIL 확인."
	@cd backend && docker buildx build --platform linux/arm64 -t $(IMG) --load .
	@docker run --rm --entrypoint sh $(IMG) -c "alembic --version && uvicorn --version"
	@docker save $(IMG) | gzip -1 | ssh "$(ORACLE)" 'gunzip | sudo docker load'
	@ssh "$(ORACLE)" 'sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait backend'

rollback-backend: ## ⚠️ 이전 backend 이미지로 롤백 (`TAG=<이전 sha>` 필수).
	@# TAG 기본값(현재 HEAD)으로 롤백하면 방금 배포한 태그를 재기록하는 no-op 이 된다.
	@# 배포 실패 직후 반사적으로 호출하는 경로라, 롤백된 줄 알고 장애가 이어진다. 명시 전달을 강제한다.
	@[ "$(origin TAG)" != "file" ] || { echo "❌ 롤백은 TAG=<이전 sha> 를 명시해야 합니다 (예: make rollback-backend TAG=abc1234)"; exit 1; }
	@ssh "$(ORACLE)" 'sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait backend'

deploy-admin: ## Oracle Cloud ARM VM admin 배포 (빌드·전송·무중단 교체).
	@# NEXT_PUBLIC_API_URL 은 rewrites 가 빌드 타임에 구워지므로 build-arg 로 넣는다.
	@# 컨테이너 내부 DNS 를 쓰면 Cloudflare 왕복이 한 번 줄어든다.
	@$(MAKE) --no-print-directory ops-check || echo "⚠️  ops-check 위반 있음 — 배포는 계속합니다. 위 DETAIL 확인."
	@cd admin && docker buildx build --platform linux/arm64 \
		--build-arg NEXT_PUBLIC_API_URL=http://backend:8080 -t $(ADMIN_IMG) --load .
	@docker save $(ADMIN_IMG) | gzip -1 | ssh "$(ORACLE)" 'gunzip | sudo docker load'
	@ssh "$(ORACLE)" 'sed -i "s/^ADMIN_TAG=.*/ADMIN_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait admin'

rollback-admin: ## ⚠️ 이전 admin 이미지로 롤백 (`TAG=<이전 sha>` 필수).
	@# deploy-backend 와 같은 이유로 TAG 명시를 강제한다 (기본값 롤백은 no-op).
	@[ "$(origin TAG)" != "file" ] || { echo "❌ 롤백은 TAG=<이전 sha> 를 명시해야 합니다 (예: make rollback-admin TAG=abc1234)"; exit 1; }
	@ssh "$(ORACLE)" 'sed -i "s/^ADMIN_TAG=.*/ADMIN_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait admin'

oracle-logs: ## Oracle Cloud VM Docker Compose 로그 follow (최근 100줄).
	@ssh -t "$(ORACLE)" 'cd ~/truewords && sudo docker compose logs -f --tail=100'

# ============================================================
# CI / 운영 작업 — GitHub Actions 대체
#
# GHA 가 청구 문제로 멈춘 동안(2026-07-24~) PR 게이트가 사라졌다. `make ci` 는
# .github/workflows/ci.yml 과 **같은 명령을 같은 순서로** 돌려 "CI 통과" 가
# 양쪽에서 같은 뜻이 되게 한다. 명령이 갈라지면 로컬 통과가 무의미해지므로
# ci.yml 을 바꿀 때 이 target 도 같이 바꾼다.
#
# 예약 작업은 VM cron 이 주인이다. 아래 target 들은 수동 실행·검증용 진입점이며
# 실제 스케줄은 VM crontab 에 있다 (infra/oracle-vm/README.md §정기 작업).
# ============================================================
ci: ## ci.yml 과 동일한 검사를 로컬에서 (backend pytest + admin test/build)
	@echo "▶ [1/5] backend — uv sync --frozen --all-groups"
	@cd backend && uv sync --frozen --all-groups
	@echo "▶ [2/5] backend — pytest (ci.yml 과 동일: --ignore 없음)"
	@cd backend && GEMINI_API_KEY=test-key-for-ci uv run pytest -q
	@echo "▶ [3/5] admin — pnpm install --frozen-lockfile"
	@cd admin && pnpm install --frozen-lockfile
	@echo "▶ [4/5] admin — pnpm test"
	@cd admin && pnpm test
	@echo "▶ [5/5] admin — pnpm build"
	@cd admin && pnpm build
	@echo ""
	@echo "✅ CI 동등 검사 통과. (lint/E2E 는 별도: make admin-lint / make admin-e2e)"

ops-check: ## 운영 불변식 점검 — 예약 작업이 "안 돈" 것까지 결과 기준으로 잡는다
	@ssh "$(ORACLE)" 'bash ~/truewords/ops-check.sh'

cron-cache-cleanup: ## semantic_cache TTL 만료 정리 수동 실행 (`ARGS=--dry-run` 지원)
	@ssh "$(ORACLE)" 'bash ~/truewords/cache-cleanup.sh $(ARGS)'

cron-refresh-questions: ## 봇별 추천 질문 갱신 수동 실행 (`ARGS=--dry-run` 지원)
	@ssh "$(ORACLE)" 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend python scripts/refresh_suggested_questions.py $(if $(ARGS),$(ARGS),--execute)'

restore-drill: ## Postgres 백업 복구 리허설 (운영 DB 는 읽기만, 임시 DB 로 대조)
	@ssh "$(ORACLE)" 'bash ~/truewords/restore-drill.sh'

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
