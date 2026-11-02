#!/usr/bin/env bash
# 테스트 예약 전용 잠금 — 정규 발송을 막지 않는다.
set -euo pipefail
cd "${TW_DIR:-${HOME}/truewords}"
exec flock -n /tmp/hoondok-test-push.lock sudo docker compose --env-file .env exec -T backend python scripts/send_hoondok_test_push.py
