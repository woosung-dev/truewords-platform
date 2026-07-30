#!/usr/bin/env bash
# Postgres 백업 복구 리허설 — 운영 DB 는 읽기만 한다.
#
# 최신 덤프를 임시 DB 로 복원해 운영본과 대조하고, 통과하면 임시 DB 를 지운다.
#
# 단순 행 수 비교로는 검증이 안 된다. 덤프 시각 이후에도 실사용 트래픽이 계속
# 들어와 행 수는 원래 어긋난다. 백업이 보장해야 하는 성질은 "덤프에 담긴 모든
# 행이 원본과 동일하게 되살아난다" 이므로, (id, 행 전체 JSON) 집합의 차집합
# `복원본 EXCEPT 운영본` 이 0 인지로 검사한다. 덤프 이후 새로 생긴 행은
# 운영본에만 있으므로 이 방향에서는 잡히지 않는다.
#
# 실행: ssh truewords-oracle 'bash ~/truewords/restore-drill.sh'
set -euo pipefail

cd ~/truewords
U=$(grep "^POSTGRES_USER=" .env | cut -d= -f2-)
D=$(grep "^POSTGRES_DB=" .env | cut -d= -f2-)
DRILL="truewords_restore_drill"
DUMP=$(sudo ls -1t /opt/backups/truewords-*.dump | head -1)

pgx() { sudo docker compose exec -T postgres "$@"; }
qd()  { pgx psql -U "$U" -d "$DRILL" -t -A -q; }   # stdin 으로 SQL

echo "== dump: $DUMP ($(sudo du -h "$DUMP" | cut -f1))"
echo "== 운영: $D  리허설: $DRILL"

pgx psql -U "$U" -d "$D" -q -c "DROP DATABASE IF EXISTS ${DRILL};"
pgx createdb -U "$U" "$DRILL"

sudo docker compose cp "$DUMP" postgres:/tmp/drill.dump
START=$(date +%s)
# `cmd; RC=$?` 는 set -e 아래에서 죽은 코드다 — 실패하면 그 줄에서 셸이 끝나 RC 는
# 늘 0 이고, 확인한 척하는 로그만 남는다. if 문 안에서는 set -e 가 유보되므로
# 실제 종료 코드를 잡을 수 있다.
if pgx pg_restore --no-owner --no-acl -U "$U" -d "$DRILL" /tmp/drill.dump; then
  RESTORE_RC=0
else
  RESTORE_RC=$?
  pgx rm -f /tmp/drill.dump || true
  echo "== 복원 실패 (rc=$RESTORE_RC) — 리허설 DB ${DRILL} 를 남겨두니 수동 조사하라." >&2
  exit 1
fi
END=$(date +%s)
pgx rm -f /tmp/drill.dump
echo "== 복원 완료 (rc=$RESTORE_RC) — $((END - START))초"

pgx psql -U "$U" -d "$DRILL" -q -c "CREATE EXTENSION IF NOT EXISTS dblink;"

TABLES=$(pgx psql -U "$U" -d "$DRILL" -t -A -c \
  "select table_name from information_schema.tables where table_schema='public' and table_name <> 'alembic_version' order by table_name;")

FAIL=0
printf '\n%-24s %8s %12s %s\n' TABLE ROWS 'DRILL⊄PROD' RESULT
for T in $TABLES; do
  OUT=$(qd <<SQL
create temp table _prod as
  select * from dblink('dbname=${D} user=${U}', 'select id::text, row_to_json(t)::text from "$T" t')
       as x(id text, j text);
select (select count(*) from "$T"),
       (select count(*) from (
          select id::text, row_to_json(t)::text as j from "$T" t
          except
          select id, j from _prod
       ) s);
drop table _prod;
SQL
)
  ROWS=$(echo "$OUT" | tr -d ' ' | cut -d'|' -f1)
  MISSING=$(echo "$OUT" | tr -d ' ' | cut -d'|' -f2)
  if [ "$MISSING" = "0" ]; then RES=OK; else RES=DIFF; FAIL=$((FAIL + 1)); fi
  printf '%-24s %8s %12s %s\n' "$T" "$ROWS" "$MISSING" "$RES"
done

PV=$(pgx psql -U "$U" -d "$D"     -t -A -c "select version_num from alembic_version;" | tr -d ' \r')
RV=$(pgx psql -U "$U" -d "$DRILL" -t -A -c "select version_num from alembic_version;" | tr -d ' \r')
printf '\n%-24s prod=%s drill=%s %s\n' alembic_version "$PV" "$RV" "$([ "$PV" = "$RV" ] && echo OK || echo DIFF)"
[ "$PV" = "$RV" ] || FAIL=$((FAIL + 1))

echo
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: PASS — 복원본의 모든 행이 운영본과 바이트 동일, alembic head 일치"
  pgx psql -U "$U" -d "$D" -q -c "DROP DATABASE ${DRILL};"
  echo "== 리허설 DB 삭제 완료"
else
  echo "RESULT: FAIL — ${FAIL}건. 리허설 DB 를 남겨두니 수동 조사하라."
fi
df -h / | tail -1
