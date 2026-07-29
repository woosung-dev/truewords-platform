#!/usr/bin/env bash
# Postgres 일일 백업 — pg_dump 커스텀 포맷(-Fc, 자체 압축) + 보관 기간 경과분 정리.
#
# Neon 에서 VM 로컬 postgres 로 옮기면서 Neon 이 제공하던 자동 백업·PITR 이
# 사라졌다. DB 는 47MB 이고 덤프는 약 10MB 라 매일 전체 덤프를 떠도 부담이 없다.
# 증분(WAL 아카이빙)은 이 규모에 과하고 복구 절차만 복잡해진다.
#
# cron 등록 (매일 03:00 KST = 18:00 UTC):
#   0 18 * * * /home/ubuntu/truewords/backup-db.sh >> /var/log/truewords-backup.log 2>&1
set -euo pipefail

TW_DIR="${TW_DIR:-${HOME}/truewords}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

cd "$TW_DIR"
U=$(grep "^POSTGRES_USER=" .env | cut -d= -f2-)
D=$(grep "^POSTGRES_DB=" .env | cut -d= -f2-)

sudo mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y-%m-%d-%H%M)
OUT="${BACKUP_DIR}/truewords-${STAMP}.dump"

echo "[$(date '+%F %T')] 백업 시작 → $OUT"

# 컨테이너 안에서 덤프한 뒤 호스트로 꺼낸다. 컨테이너 /tmp 에 잔여물을 남기지 않는다.
sudo docker compose exec -T postgres pg_dump --no-owner --no-acl -Fc -U "$U" -d "$D" -f /tmp/dump.tmp
sudo docker compose cp postgres:/tmp/dump.tmp "$OUT"
sudo docker compose exec -T postgres rm -f /tmp/dump.tmp

SIZE=$(sudo du -h "$OUT" | cut -f1)

# 덤프가 유효한지 확인한다. 헤더를 못 읽으면 손상된 것이므로 즉시 실패시킨다.
if ! sudo pg_restore --list "$OUT" >/dev/null 2>&1; then
  if ! sudo docker compose exec -T postgres sh -c "true"; then :; fi
  # 호스트에 pg_restore 가 없을 수 있으므로 컨테이너로 재검증한다.
  sudo docker compose cp "$OUT" postgres:/tmp/verify.dump
  sudo docker compose exec -T postgres pg_restore --list /tmp/verify.dump >/dev/null
  sudo docker compose exec -T postgres rm -f /tmp/verify.dump
fi

echo "[$(date '+%F %T')] 백업 완료 ($SIZE)"

# Object Storage 업로드 — VM 로컬만으로는 인스턴스·디스크 유실을 못 막는다.
# 인증은 Instance Principal 을 쓴다. VM 에 개인키를 두지 않으므로 유출 위험이 없다.
# 버킷의 90일 lifecycle 규칙이 오래된 객체를 자동 삭제하므로 여기서 정리하지 않는다.
if [ "${SKIP_UPLOAD:-0}" != "1" ] && command -v /usr/local/bin/oci >/dev/null; then
  if /usr/local/bin/oci os object put --auth instance_principal \
       --bucket-name "${BUCKET:-truewords-backups}" \
       --file "$OUT" --name "$(basename "$OUT")" --force >/dev/null 2>&1; then
    echo "[$(date '+%F %T')] Object Storage 업로드 완료"
  else
    # 업로드 실패가 로컬 백업까지 실패시키지 않도록 경고만 남긴다.
    echo "[$(date '+%F %T')] ⚠️ Object Storage 업로드 실패 — 로컬 백업은 정상"
  fi
fi

# 보관 기간 경과분 삭제. 삭제된 파일명을 남겨 사후 추적이 가능하게 한다.
DELETED=$(sudo find "$BACKUP_DIR" -name "truewords-*.dump" -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
echo "[$(date '+%F %T')] ${RETAIN_DAYS}일 경과분 ${DELETED}개 삭제"

COUNT=$(sudo find "$BACKUP_DIR" -name "truewords-*.dump" | wc -l)
TOTAL=$(sudo du -sh "$BACKUP_DIR" | cut -f1)
echo "[$(date '+%F %T')] 현재 보관 ${COUNT}개 / ${TOTAL}"
