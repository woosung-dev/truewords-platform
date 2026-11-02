#!/usr/bin/env bash
# 관련 두 항목만 교체하고 다른 cron 은 그대로 둔다.
set -euo pipefail
job_dir="${TW_DIR:-${HOME}/truewords}"
[[ "$job_dir" =~ ^/[a-zA-Z0-9_/-]+$ ]] || { echo 'cron 경로 형식 오류' >&2; exit 1; }
current=$(mktemp)
next=$(mktemp)
trap 'rm -f "$current" "$next"' EXIT
if ! crontab -l > "$current" 2> "$next"; then
  if ! grep -q 'no crontab for' "$next"; then cat "$next" >&2; exit 1; fi
fi
awk '!/^[^#].*\/send-hoondok(-test)?-push\.sh([[:space:]]|$)/' "$current" > "$next"
printf '*/5 * * * * %s/send-hoondok-push.sh >> %s/truewords-cron.log 2>&1\n' "$job_dir" "$HOME" >> "$next"
printf '* * * * * %s/send-hoondok-test-push.sh >> %s/truewords-cron.log 2>&1\n' "$job_dir" "$HOME" >> "$next"
crontab "$next"
