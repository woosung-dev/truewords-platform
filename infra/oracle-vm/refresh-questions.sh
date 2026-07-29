#!/usr/bin/env bash
# 봇별 추천 질문 주간 갱신 — backend 컨테이너 안에서 실행한다.
#
# 이전에는 GitHub Actions (refresh-suggested-questions.yml) 가 runner 에서 직접
# 돌았다. Postgres 가 Neon 에서 VM 로컬로 옮겨오면서 (127.0.0.1 바인딩, Security
# List 는 TCP 22 만 허용) runner 가 DB 에 닿을 수 없게 됐다. 워크플로를 그대로
# 두면 낡은 Neon 연결 문자열로 붙어 아무 효과 없는 성공을 기록한다.
#
# backend 이미지에는 scripts/ 와 .venv 가 그대로 들어 있고 compose 가 운영
# 환경변수를 주입하므로, 컨테이너 안에서 실행하는 것이 가장 짧고 정확하다.
#
# cron 등록 (매주 월요일 03:30 KST = 일요일 18:30 UTC):
#   30 18 * * 0 /home/ubuntu/truewords/refresh-questions.sh >> /home/ubuntu/truewords-cron.log 2>&1
set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
cd "$TW_DIR"

echo "[$(date '+%F %T')] 추천 질문 갱신 시작"

# 주 1회 근거: 30일 슬라이딩 윈도우 기준 일별 데이터 변동이 약 3% 라 매일 갱신은
# 무가치한 Gemini 호출이 90%+ 다. 1회 실패해도 신규 봇은 FALLBACK_PROMPTS 로
# 노출이 유지되므로 운영 중단 risk 가 없다.
sudo docker compose --env-file .env exec -T backend \
  python scripts/refresh_suggested_questions.py --execute "$@"

echo "[$(date '+%F %T')] 추천 질문 갱신 완료"
