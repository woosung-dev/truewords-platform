-- 훈독 베타 1차 판정 쿼리 2개 (PLAN-HD-006 §6 · runbook "베타 1차 판정 쿼리 2개").
--
-- 실행:
--   ssh truewords-oracle 'cd ~/truewords && sudo docker compose --env-file .env exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < apps/api/scripts/hoondok_beta_metrics.sql
--
-- 읽기 전용이다. 별도 이벤트 수집기 없이 users.created_at 과 mission_logs 만 쓴다.
-- 날짜 기준은 KST 고정(PLAN-HD-001 결정 9). users.created_at 은 naive UTC 컬럼이라
-- 'UTC' → 'Asia/Seoul' 두 단계로 변환한다. mission_logs.mission_date 는 이미 KST 날짜다.
--
-- [가정] 두 지표 모두 **완료 기록을 방문의 대리 지표**로 쓴다. 방문 로그가 없어서다.
--        열어만 보고 완료하지 않은 사용자는 미방문으로 세므로 수치는 보수적(낮게 나온다).
--
-- 분모(공통): 가입 후 7일이 지난 살아 있는 계정. 가입 당일 사용자는 7일을 채울 수 없어 제외한다.

\echo
\echo '== 지표 1. 최근 7일 중 5일 이상 read 완료 비율 =========================='
\echo '   분모: 가입 KST 날짜 < 오늘-7 인 미삭제 계정'
\echo '   분자: 그 중 어제까지 7일(오늘-7 ~ 오늘-1) 동안 read 완료일이 5일 이상'

WITH d AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today
),
eligible AS (
    SELECT u.id,
           (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS signed_up_on
    FROM users u, d
    WHERE u.deleted_at IS NULL
      AND (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date < d.today - 7
),
active AS (
    SELECT e.id,
           count(DISTINCT m.mission_date) AS done_days
    FROM eligible e
    JOIN d ON true
    LEFT JOIN mission_logs m
           ON m.user_id = e.id
          AND m.kind = 'read'
          AND m.mission_date BETWEEN d.today - 7 AND d.today - 1
    GROUP BY e.id
)
SELECT count(*)                                              AS denominator_users,
       count(*) FILTER (WHERE done_days >= 5)                AS numerator_users,
       round(
           100.0 * count(*) FILTER (WHERE done_days >= 5) / NULLIF(count(*), 0),
           1
       )                                                     AS percent
FROM active;

\echo
\echo '== 지표 2. D7 재방문 비율 =============================================='
\echo '   분모: 지표 1과 동일'
\echo '   분자: 가입일 +7일 이후 날짜의 mission_logs 가 1건 이상인 계정'
\echo '   [가정] 완료 기록 = 방문 대리 지표 (kind 를 가리지 않는다)'

WITH d AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today
),
eligible AS (
    SELECT u.id,
           (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS signed_up_on
    FROM users u, d
    WHERE u.deleted_at IS NULL
      AND (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date < d.today - 7
)
SELECT count(*)                                  AS denominator_users,
       count(*) FILTER (WHERE returned)          AS numerator_users,
       round(100.0 * count(*) FILTER (WHERE returned) / NULLIF(count(*), 0), 1) AS percent
FROM (
    SELECT e.id,
           EXISTS (
               SELECT 1
               FROM mission_logs m
               WHERE m.user_id = e.id
                 AND m.mission_date >= e.signed_up_on + 7
           ) AS returned
    FROM eligible e
) AS r;

\echo
