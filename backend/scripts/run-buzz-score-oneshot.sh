#!/bin/bash
# ============================================================
# Buzz Score DB 반영 원샷 (증거 수집 + 적용 + 검증)
# 전제:
# - backend/.env에 DB_HOST/DB_PORT/DB_USER/DB_NAME 존재
# - PGPASSWORD는 터미널 환경변수로만 주입 (스크립트에 하드코딩 금지)
# 사용:
#   export PGPASSWORD="****"
#   bash scripts/run-buzz-score-oneshot.sh   (파일로 저장해도 되고, 그대로 붙여넣어도 됨)
# ============================================================

set -u

ROOT="/Users/kimsungtae/toss/fairpick-app"
BACKEND="$ROOT/backend"

cd "$BACKEND"

echo "============================================================"
echo "0) 위치 확인"
echo "============================================================"
pwd

echo "============================================================"
echo "1) DB env 로드 (비번 제외)"
echo "============================================================"
if [ ! -f ".env" ]; then
  echo "❌ backend/.env not found"
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -E '^(DB_HOST|DB_PORT|DB_USER|DB_NAME)=' .env | xargs)

: "${DB_HOST:?missing}"
: "${DB_PORT:?missing}"
: "${DB_USER:?missing}"
: "${DB_NAME:?missing}"

echo "DB_HOST=$DB_HOST"
echo "DB_PORT=$DB_PORT"
echo "DB_USER=$DB_USER"
echo "DB_NAME=$DB_NAME"
echo "PGPASSWORD is set? -> $( [ -n "${PGPASSWORD:-}" ] && echo YES || echo NO )"
if [ -z "${PGPASSWORD:-}" ]; then
  echo "❌ PGPASSWORD is not set. Run: export PGPASSWORD='*****'"
  exit 1
fi

psql_base=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1)

echo "============================================================"
echo "2) (증거) 레포 산출물 존재 확인"
echo "============================================================"
BUZZ_MIG="$BACKEND/migrations/20260120_add_buzz_score_infrastructure.sql"
VERIFY_SQL="$BACKEND/scripts/verify-buzz-score.sql"

[ -f "$BUZZ_MIG" ] || { echo "❌ missing: $BUZZ_MIG"; exit 1; }
echo "✅ migration: $BUZZ_MIG"

if [ -f "$VERIFY_SQL" ]; then
  echo "✅ verify sql: $VERIFY_SQL"
else
  echo "⚠️ verify sql not found: $VERIFY_SQL (will skip)"
fi

echo "---- migration 핵심 라인(buzz/event_views/event_actions) ----"
grep -nE "buzz_score|buzz_updated_at|buzz_components|event_views|event_actions" "$BUZZ_MIG" || true

echo "============================================================"
echo "3) (DB Truth) 현재 상태 스냅샷"
echo "============================================================"
"${psql_base[@]}" -c "SELECT current_user, current_database(), inet_server_port(), version();"

"${psql_base[@]}" -c "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_deleted=false) AS active FROM canonical_events;"

echo "-- buzz columns 존재 여부(현재) --"
"${psql_base[@]}" -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_events'
  AND column_name IN ('buzz_score','buzz_updated_at','buzz_components')
ORDER BY column_name;"

echo "-- event tables 존재 여부(현재) --"
"${psql_base[@]}" -c "
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('event_views','event_actions')
ORDER BY table_name;"

echo "============================================================"
echo "4) 선행 조건: event_views 생성 마이그레이션 탐색/실행"
echo "============================================================"
EV_CREATE_FILE="$(grep -RIlE "CREATE TABLE( IF NOT EXISTS)?[[:space:]]+event_views" "$BACKEND/migrations" 2>/dev/null | head -n 1 || true)"

if [ -n "${EV_CREATE_FILE:-}" ]; then
  echo "✅ event_views create migration found: $EV_CREATE_FILE"
  echo "---- head ----"
  sed -n '1,80p' "$EV_CREATE_FILE"

  echo "---- run event_views migration ----"
  "${psql_base[@]}" -f "$EV_CREATE_FILE"

  echo "---- confirm event_views ----"
  "${psql_base[@]}" -c "\dt event_views"
else
  echo "⚠️ event_views create migration NOT found."
  echo "   buzz infra migration에 ALTER TABLE event_views가 있으면 여기서 실패할 수 있음."
fi

echo "============================================================"
echo "5) buzz infra 마이그레이션 실행 (실패해도 원인/상태 출력)"
echo "============================================================"
set +e
"${psql_base[@]}" -f "$BUZZ_MIG"
MIG_RC=$?
set -e

if [ $MIG_RC -ne 0 ]; then
  echo "❌ buzz migration failed (rc=$MIG_RC). 아래 상태를 추가로 출력합니다."
fi

echo "-- buzz columns 존재 여부(적용 후) --"
"${psql_base[@]}" -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_events'
  AND column_name IN ('buzz_score','buzz_updated_at','buzz_components')
ORDER BY column_name;"

echo "-- event_actions 존재 여부(적용 후) --"
"${psql_base[@]}" -c "\dt event_actions" 2>/dev/null || true

echo "============================================================"
echo "6) 배치 실행 (존재하는 npm script만 실행)"
echo "============================================================"
if [ -f "$BACKEND/package.json" ]; then
  echo "---- available scripts (buzz 관련만) ----"
  node -e "const p=require('./package.json');console.log(Object.keys(p.scripts||{}).filter(k=>k.toLowerCase().includes('buzz')).join('\n'))"
else
  echo "⚠️ package.json not found"
fi

# 우선순위: update:buzz-score -> job:update-buzz-score -> 직접 ts-node 실행
set +e
npm run update:buzz-score
RC1=$?
if [ $RC1 -ne 0 ]; then
  npm run job:update-buzz-score
  RC2=$?
  if [ $RC2 -ne 0 ]; then
    echo "⚠️ npm scripts failed. fallback: ts-node job file (if exists)"
    if [ -f "$BACKEND/src/jobs/updateBuzzScore.ts" ]; then
      npx ts-node -r dotenv/config src/jobs/updateBuzzScore.ts
    else
      echo "❌ src/jobs/updateBuzzScore.ts not found"
    fi
  fi
fi
set -e

echo "============================================================"
echo "7) verify SQL + 최종 DB Truth 요약"
echo "============================================================"
if [ -f "$VERIFY_SQL" ]; then
  "${psql_base[@]}" -f "$VERIFY_SQL"
fi

"${psql_base[@]}" -c "
SELECT
  COUNT(*) FILTER (WHERE is_deleted=false) AS active,
  COUNT(*) FILTER (WHERE is_deleted=false AND buzz_score IS NULL) AS buzz_null,
  COUNT(*) FILTER (WHERE is_deleted=false AND buzz_score = 0) AS buzz_zero,
  MAX(buzz_score) AS max_buzz,
  ROUND(AVG(buzz_score)::numeric, 2) AS avg_buzz
FROM canonical_events;"

"${psql_base[@]}" -c "
SELECT
  COUNT(*) FILTER (WHERE is_deleted=false AND buzz_updated_at IS NOT NULL) AS updated_cnt,
  MAX(buzz_updated_at) AS last_buzz_updated_at
FROM canonical_events;"

echo "✅ DONE"
echo "NOTE: avg/max가 0에 가깝다면 event_views/event_actions에 데이터 유입이 없어서일 수 있습니다."
