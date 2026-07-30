#!/usr/bin/env bash
# semantic_cache TTL 만료 point 정리 — backend 컨테이너 안에서 실행한다.
#
# Qdrant 가 point 단위 native TTL 을 지원하지 않아 필요한 운영 작업이다.
# `payload.created_at < now - CACHE_TTL_DAYS*86400` 인 point 를 삭제한다.
#
# 원래 GitHub Actions (cache-cleanup.yml) 가 매일 돌았다. 2026-07-24 경부터
# Actions 가 청구 문제로 실행되지 않아 만료 point 가 134개까지 누적됐고,
# 예약 작업이 매일 실패해도 아무도 알 수 없었다. 실행을 VM 으로 내려
# 외부 청구 상태와 무관하게 돌도록 한다.
#
# backend 컨테이너 안에서 도는 이유: compose 가 운영 QDRANT_URL /
# QDRANT_API_KEY / CACHE_COLLECTION_NAME 를 이미 주입하고 있어 자격증명을
# 다른 곳에 복제할 필요가 없다.
#
# cron 등록 (매일 03:15 KST = 18:15 UTC):
#   15 18 * * * /home/ubuntu/truewords/cache-cleanup.sh >> /home/ubuntu/truewords-cron.log 2>&1
#
# 18:00 이 아니라 18:15 인 이유: backup-db.sh 가 18:00 에 DB 전체를 덤프한다.
# 2 OCPU VM 에서 두 `docker compose exec` 를 같이 돌릴 이유가 없어 15분 비켜 둔다.
#
# 로그를 /var/log 에 두지 않는다 — cron 은 ubuntu 로 돌고 /var/log 는 root
# 전용이라 리다이렉트가 열리는 단계에서 죽는다 (backup-db.sh 주석 참고).
set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
cd "$TW_DIR"

echo "[$(date '+%F %T')] semantic_cache 정리 시작"

# 인자를 그대로 넘겨 --dry-run / --ttl-days override 를 수동 실행 때 쓸 수 있게 한다.
sudo docker compose --env-file .env exec -T backend \
  python scripts/cleanup_semantic_cache.py "${@:---execute}"

echo "[$(date '+%F %T')] semantic_cache 정리 완료"
