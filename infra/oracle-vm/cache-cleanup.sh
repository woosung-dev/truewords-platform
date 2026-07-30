#!/usr/bin/env bash
# semantic_cache TTL 만료 point 정리 — backend 컨테이너 안에서 실행한다.
#
# Qdrant 가 point 단위 native TTL 을 지원하지 않아 필요한 운영 작업이다.
# `payload.created_at < now - CACHE_TTL_DAYS*86400` 인 point 를 삭제한다.
#
# **정기 스케줄의 주인은 이 스크립트가 아니라 .github/workflows/cache-cleanup.yml
# 이다.** cron 에 등록하지 않는다 — 스케줄러가 둘이면 같은 작업이 두 번 돈다.
#
# 이건 수동 실행 진입점이다. 쓰는 경우:
#   - GHA 가 멈춘 동안 (청구 차단 등) 사람이 대신 돌릴 때
#   - 삭제 대상을 먼저 보고 싶을 때 (--dry-run)
#   - TTL 을 다르게 줘서 강제 정리할 때 (--ttl-days N)
#
# 로컬 Mac 에서: `make cron-cache-cleanup [ARGS=--dry-run]`
#
# backend 컨테이너 안에서 도는 이유: compose 가 운영 QDRANT_URL /
# QDRANT_API_KEY / CACHE_COLLECTION_NAME 를 이미 주입하고 있어 자격증명을
# 다른 곳에 복제할 필요가 없다. GHA 경로는 같은 스크립트를 secrets 로 돌린다.
set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
cd "$TW_DIR"

echo "[$(date '+%F %T')] semantic_cache 정리 시작"

# 인자를 그대로 넘겨 --dry-run / --ttl-days override 를 수동 실행 때 쓸 수 있게 한다.
sudo docker compose --env-file .env exec -T backend \
  python scripts/cleanup_semantic_cache.py "${@:---execute}"

echo "[$(date '+%F %T')] semantic_cache 정리 완료"
