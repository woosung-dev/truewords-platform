#!/usr/bin/env bash
# 훈독 Web Push 발송 — backend 컨테이너 안에서 실행한다 (PLAN-HD-006 §2-6).
#
# 사용자마다 발송 시각(read_time)이 다르므로 스케줄러는 "그 시각에 딱 한 번" 이
# 아니라 15분마다 돌며 창(read_time ~ +2h)에 든 사람을 찾는다. 하루 1회 보장은
# push_subscriptions.last_sent_on 이 갖는다 — cron 이 두 번 돌아도 두 번 가지 않는다.
#
# GHA cron 을 쓰지 않는다: Postgres 가 VM 127.0.0.1 바인딩이고, 2026-08 청구 차단으로
# GHA 예약 작업이 25일간 조용히 멈춘 이력이 있다(infra/oracle-vm/README.md §정기 작업).
#
# cron 등록 (15분 간격):
#   */15 * * * *  /home/ubuntu/truewords/send-hoondok-push.sh >> /home/ubuntu/truewords-cron.log 2>&1
#
# VAPID 3값이 .env 에 없으면 스크립트는 {"mode":"disabled",...} 를 찍고 exit 0 이다 —
# 알림을 켜기 전에 cron 을 먼저 등록해도 무해하다.
#
# 실기기 증거 1회 발송(창·완료 조건 무시):
#   /home/ubuntu/truewords/send-hoondok-push.sh --to-email me@example.com
set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
cd "$TW_DIR"

# 15분마다 쌓이는 로그다 — 시작/완료 두 줄을 남기면 하루 192줄이 된다.
# 타임스탬프 한 줄 뒤에 스크립트의 요약 JSON 한 줄만 붙인다.
printf '[%s] hoondok push ' "$(date '+%F %T')"

# flock -n: 이전 run 이 아직 돌고 있으면(푸시 서비스 응답 지연 등) 겹쳐 띄우지 않고 그냥 끝낸다.
# 하루 1회 보장은 last_sent_on 이 갖지만, 겹친 run 은 mark 전에 같은 사용자에게 중복 발송할 수 있다.
exec flock -n /tmp/hoondok-push.lock \
  sudo docker compose --env-file .env exec -T backend \
  python scripts/send_hoondok_push.py --execute "$@"
