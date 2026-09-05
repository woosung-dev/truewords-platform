# TrueWords Platform — 자주 쓰는 작업을 모아둔 Makefile
# 사용법: `make` (도움말) / `make <target>`
#
# 디렉터리: apps/web·admin (Next.js 16 + pnpm), apps/api (FastAPI + uv)

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
WEB_IMG := truewords-web:$(TAG)
WEB_URL ?= http://localhost:3000
ADMIN_URL ?= http://localhost:3001

.PHONY: help \
        admin-dev admin-type admin-lint admin-test admin-test-watch admin-build admin-e2e admin-install \
        backend-dev backend-test backend-test-fast backend-lint backend-install backend-migrate backend-start \
        infra-up infra-down infra-logs infra-status infra-reset \
        deploy-backend rollback-backend deploy-admin rollback-admin oracle-logs \
        ci ops-check cron-cache-cleanup cron-refresh-questions restore-drill \
        verify verify-modal test-all type-check clean web-dev web-build web-test web-type \
        deploy-web rollback-web contracts-check

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
verify: verify-modal type-check ## 원문 모달 단위 테스트 + 모든 TS 패키지 타입 검사

verify-modal: ## 원문 보기 모달 단위 테스트만 (source-original-modal)
	@echo "▶ source-original-modal 단위 테스트 실행"
	@pnpm --filter @truewords/web exec vitest run src/test/source-original-modal.test.tsx

# ============================================================
# Admin (Next.js 16, pnpm)
# ============================================================
web-dev: ## 사용자 웹 dev 서버 (http://localhost:3000)
	@pnpm --filter @truewords/web dev

web-build: ## 사용자 웹 프로덕션 빌드
	@pnpm --filter @truewords/web build

web-test: ## 사용자 웹 Vitest
	@pnpm --filter @truewords/web test

web-type: ## 사용자 웹 타입 검사
	@pnpm --filter @truewords/web typecheck

admin-dev: ## admin dev 서버 (http://localhost:3001)
	@cd apps/admin && pnpm dev

admin-type: ## admin TypeScript 타입 체크 (tsc --noEmit)
	@cd apps/admin && pnpm tsc --noEmit

admin-lint: ## admin ESLint
	@cd apps/admin && pnpm lint

admin-test: ## admin Vitest 단위 테스트 1회 실행
	@cd apps/admin && pnpm test

admin-test-watch: ## admin Vitest watch 모드
	@cd apps/admin && pnpm test:watch

admin-build: ## admin 프로덕션 빌드
	@cd apps/admin && pnpm build

admin-e2e: ## admin Playwright E2E (헤드리스)
	@pnpm test:e2e

admin-install: ## admin 의존성 설치 (pnpm install)
	@pnpm install --frozen-lockfile

# ============================================================
# Backend (FastAPI, uv)
# ============================================================
backend-dev: ## backend dev 서버 (http://localhost:8000, --reload)
	@cd apps/api && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

backend-test: ## backend 전체 pytest (chunker_hierarchical 제외 — 메모리 정책)
	@cd apps/api && uv run pytest --ignore=tests/test_chunker_hierarchical.py

backend-test-fast: ## backend pytest fail-fast (-x, 첫 실패 즉시 중단)
	@cd apps/api && uv run pytest -x --ignore=tests/test_chunker_hierarchical.py

backend-lint: ## backend ruff lint (있을 때만)
	@cd apps/api && (uv run ruff check . 2>/dev/null || echo "ruff 미설정 — skip")

backend-install: ## API 의존성 설치 (uv.lock 고정, 비밀 환경 파일은 별도 설정)
	@cd apps/api && uv sync --frozen --all-groups

backend-migrate: ## backend alembic 마이그레이션 적용 (upgrade head)
	@cd apps/api && uv run alembic upgrade head

backend-start: infra-up backend-migrate backend-dev ## 인프라 up → 마이그레이션 → dev 서버 (cold start 한 방)

# ============================================================
# Local infra — Docker Compose (PostgreSQL + Qdrant)
# apps/api/docker-compose.yml 의 postgres/qdrant 서비스만 사용. backend 서비스는
# 호스트(uvicorn)에서 직접 띄운다.
# ============================================================
infra-up: ## postgres + qdrant 컨테이너 기동 (백그라운드, healthy 까지 대기)
	@cd apps/api && docker compose up -d --wait postgres qdrant

infra-down: ## postgres + qdrant 컨테이너 정지 (볼륨은 보존)
	@cd apps/api && docker compose down

infra-logs: ## postgres + qdrant 로그 follow (Ctrl+C 로 종료)
	@cd apps/api && docker compose logs -f postgres qdrant

infra-status: ## 컨테이너 상태 + 포트 binding 확인
	@cd apps/api && docker compose ps

infra-reset: ## ⚠️ 컨테이너 + 데이터 볼륨까지 전부 삭제 (postgres/qdrant 데이터 초기화)
	@echo "⚠️  postgres_data, qdrant_data 볼륨까지 삭제됩니다. 5초 후 진행 (Ctrl+C 로 취소)..."
	@sleep 5
	@cd apps/api && docker compose down -v

# ============================================================
# Oracle Cloud VM 배포
# ============================================================
deploy-backend: ## Oracle Cloud ARM VM backend 배포 (중단 가능, 별도 승인 필요).
	@# 배포는 사람이 VM 을 들여다보는 몇 안 되는 순간이다. 예약 작업이 조용히
	@# 죽어 있으면 여기서라도 눈에 들어오게 한다. 배포를 막지는 않는다 —
	@# 백업이 낡았다고 배포를 못 하게 하는 건 인과가 뒤집힌 것이다.
	@$(MAKE) --no-print-directory ops-check || echo "⚠️  ops-check 위반 있음 — 배포는 계속합니다. 위 DETAIL 확인."
	@docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t $(IMG) --load .
	@docker run --rm --entrypoint sh $(IMG) -c "alembic --version && uvicorn --version"
	@docker save $(IMG) | gzip -1 | ssh "$(ORACLE)" 'gunzip | sudo docker load'
	@ssh "$(ORACLE)" 'sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait backend'
	@$(MAKE) --no-print-directory prune-images

rollback-backend: ## ⚠️ 이전 backend 이미지로 롤백 (`TAG=<이전 sha>` 필수).
	@# TAG 기본값(현재 HEAD)으로 롤백하면 방금 배포한 태그를 재기록하는 no-op 이 된다.
	@# 배포 실패 직후 반사적으로 호출하는 경로라, 롤백된 줄 알고 장애가 이어진다. 명시 전달을 강제한다.
	@[ "$(origin TAG)" != "file" ] || { echo "❌ 롤백은 TAG=<이전 sha> 를 명시해야 합니다 (예: make rollback-backend TAG=abc1234)"; exit 1; }
	@ssh "$(ORACLE)" 'sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait backend'

deploy-admin: ## Oracle Cloud ARM VM admin 배포 (WEB_URL·ADMIN_URL 운영 값 필수).
	@case "$(WEB_URL) $(ADMIN_URL)" in *localhost*) echo "WEB_URL·ADMIN_URL 운영 HTTPS origin을 명시하세요"; exit 1;; esac
	@# NEXT_PUBLIC_API_URL 은 rewrites 가 빌드 타임에 구워지므로 build-arg 로 넣는다.
	@# 컨테이너 내부 DNS 를 쓰면 Cloudflare 왕복이 한 번 줄어든다.
	@$(MAKE) --no-print-directory ops-check || echo "⚠️  ops-check 위반 있음 — 배포는 계속합니다. 위 DETAIL 확인."
	@docker buildx build --platform linux/arm64 -f apps/admin/Dockerfile \
		--build-arg NEXT_PUBLIC_API_URL=http://backend:8080 \
		--build-arg NEXT_PUBLIC_WEB_URL=$(WEB_URL) --build-arg NEXT_PUBLIC_ADMIN_URL=$(ADMIN_URL) -t $(ADMIN_IMG) --load .
	@docker save $(ADMIN_IMG) | gzip -1 | ssh "$(ORACLE)" 'gunzip | sudo docker load'
	@ssh "$(ORACLE)" 'sed -i "s/^ADMIN_TAG=.*/ADMIN_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait admin'
	@$(MAKE) --no-print-directory prune-images

rollback-admin: ## ⚠️ 이전 admin 이미지로 롤백 (`TAG=<이전 sha>` 필수).
	@# deploy-backend 와 같은 이유로 TAG 명시를 강제한다 (기본값 롤백은 no-op).
	@[ "$(origin TAG)" != "file" ] || { echo "❌ 롤백은 TAG=<이전 sha> 를 명시해야 합니다 (예: make rollback-admin TAG=abc1234)"; exit 1; }
	@ssh "$(ORACLE)" 'sed -i "s/^ADMIN_TAG=.*/ADMIN_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait admin'

deploy-web: ## Oracle Cloud ARM VM 사용자 웹 배포 (운영 전환 runbook 선행).
	@case "$(WEB_URL) $(ADMIN_URL)" in *localhost*) echo "WEB_URL·ADMIN_URL 운영 HTTPS origin을 명시하세요"; exit 1;; esac
	@docker buildx build --platform linux/arm64 -f apps/web/Dockerfile \
		--build-arg NEXT_PUBLIC_API_URL=http://backend:8080 \
		--build-arg NEXT_PUBLIC_WEB_URL=$(WEB_URL) --build-arg NEXT_PUBLIC_ADMIN_URL=$(ADMIN_URL) -t $(WEB_IMG) --load .
	@docker save $(WEB_IMG) | gzip -1 | ssh "$(ORACLE)" 'gunzip | sudo docker load'
	@ssh "$(ORACLE)" 'grep -q "^WEB_TAG=" ~/truewords/.env || { echo "runbook에 따라 WEB_TAG와 Compose를 먼저 준비하세요"; exit 1; }; sed -i "s/^WEB_TAG=.*/WEB_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait web'
	@$(MAKE) --no-print-directory prune-images

rollback-web: ## 이전 사용자 웹 이미지로 롤백 (`TAG=<이전 sha>` 필수).
	@[ "$(origin TAG)" != "file" ] || { echo "TAG=<이전 sha>를 명시하세요"; exit 1; }
	@ssh "$(ORACLE)" 'sed -i "s/^WEB_TAG=.*/WEB_TAG=$(TAG)/" ~/truewords/.env && cd ~/truewords && sudo docker compose up -d --wait web'

prune-images: ## VM 의 오래된 truewords 이미지·빌드 캐시 정리 (최신 3개 + 실행 중은 보존)
	@# `docker image prune` 은 여기서 무효다 — 구버전 이미지가 전부 커밋 sha 태그를
	@# 달고 있어 dangling 이 아니다(실측 dangling 0개). 스크립트가 생성시각순으로
	@# 정렬해 최신 N개만 남긴다. `KEEP=5` / `DRY_RUN=1` 로 조정할 수 있다.
	@ssh "$(ORACLE)" '$(if $(KEEP),KEEP=$(KEEP) ,)$(if $(DRY_RUN),DRY_RUN=$(DRY_RUN) ,)bash ~/truewords/prune-images.sh'

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
ci: ## 전체 CI 검증 (API·웹·관리자·계약·문서, E2E 별도)
	@cd apps/api && uv sync --frozen --all-groups
	@cd apps/api && GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run pytest -q
	@pnpm install --frozen-lockfile
	@pnpm contracts:check
	@pnpm tooling:test
	@pnpm docs:check
	@pnpm boundaries:check
	@pnpm test && pnpm lint && pnpm build && pnpm typecheck

contracts-check: ## 계약 재생성·drift 및 하위 호환성 검사
	@pnpm contracts:check

ops-check: ## 운영 불변식 점검 — 예약 작업이 "안 돈" 것까지 결과 기준으로 잡는다
	@ssh "$(ORACLE)" 'bash ~/truewords/ops-check.sh'

gemini-check: ## Gemini 운영 키 생존 확인 (ops-check 의 gemini-key 항목만 단독 실행)
	@# GCP 프로젝트·키를 건드린 직후 "챗봇이 아직 살아 있나" 를 즉시 확인하는 용도.
	@# ops-check 전체(백업·DB·컨테이너)를 돌릴 필요가 없는 순간이 실제로 있었다.
	@ssh "$(ORACLE)" 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend python scripts/gemini_key_probe.py'

cron-cache-cleanup: ## semantic_cache TTL 만료 정리 수동 실행 (`ARGS=--dry-run` 지원)
	@ssh "$(ORACLE)" 'bash ~/truewords/cache-cleanup.sh $(ARGS)'

cron-refresh-questions: ## 봇별 추천 질문 갱신 수동 실행 (`ARGS=--dry-run` 지원)
	@ssh "$(ORACLE)" 'cd ~/truewords && sudo docker compose --env-file .env exec -T backend python scripts/refresh_suggested_questions.py $(if $(ARGS),$(ARGS),--execute)'

restore-drill: ## Postgres 백업 복구 리허설 (운영 DB 는 읽기만, 임시 DB 로 대조)
	@ssh "$(ORACLE)" 'bash ~/truewords/restore-drill.sh'

# ============================================================
# 통합
# ============================================================
test-all: web-test admin-test backend-test ## web + admin + API 단위 테스트

type-check: ## 모든 TypeScript 패키지 타입 검사
	@pnpm typecheck

clean: ## 빌드 산출물 정리 (.next, __pycache__, .pytest_cache)
	@echo "▶ apps/admin/.next 삭제"
	@rm -rf apps/admin/.next
	@echo "▶ Python 캐시 삭제"
	@find apps/api -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
	@find apps/api -type d -name ".pytest_cache" -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "▶ 완료"
