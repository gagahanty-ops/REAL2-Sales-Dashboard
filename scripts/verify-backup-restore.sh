#!/usr/bin/env bash
# Rehearses a restore into an isolated local database. It never touches
# production and never prints a secret value.
#
# `psql` is used by default; set PSQL_COMMAND to run it elsewhere, for example
# inside a container: PSQL_COMMAND="docker exec -i supabase_db_real2 psql".
set -euo pipefail

FIXTURE=""
DATABASE_URL="${RESTORE_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
TARGET_DB="real2_restore_rehearsal"
PSQL_COMMAND="${PSQL_COMMAND:-psql}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture)
      FIXTURE="${2:-}"
      shift 2
      ;;
    *)
      echo "usage: verify-backup-restore.sh --fixture <dump.sql>" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${FIXTURE}" || ! -f "${FIXTURE}" ]]; then
  echo "дамп не найден: ${FIXTURE}" >&2
  exit 2
fi

if [[ "${DATABASE_URL}" != *"127.0.0.1"* && "${DATABASE_URL}" != *"localhost"* ]]; then
  echo "репетиция выполняется только на локальной базе" >&2
  exit 2
fi

run_psql() {
  local url="$1"
  shift
  # shellcheck disable=SC2086
  ${PSQL_COMMAND} "${url}" -v ON_ERROR_STOP=1 "$@"
}

echo "1/4 создаём изолированную базу ${TARGET_DB}"
run_psql "${DATABASE_URL}" -c "drop database if exists ${TARGET_DB}" >/dev/null
run_psql "${DATABASE_URL}" -c "create database ${TARGET_DB}" >/dev/null

RESTORE_URL="${DATABASE_URL%/*}/${TARGET_DB}"

echo "2/4 применяем дамп"
run_psql "${RESTORE_URL}" -f - < "${FIXTURE}" >/dev/null

echo "3/4 проверяем, что внешние переключатели выключены"
ENABLED=$(run_psql "${RESTORE_URL}" -t -A -c \
  "select count(*) from system_controls where key in ('sync_enabled','sheet_publish_enabled') and enabled" | tr -d '[:space:]')
if [[ "${ENABLED}" != "0" ]]; then
  echo "восстановленная база пришла с включённым внешним переключателем" >&2
  exit 1
fi

echo "4/4 сверяем контрольные суммы снимков"
BROKEN=$(run_psql "${RESTORE_URL}" -t -A -c \
  "select count(*) from metric_snapshots where checksum !~ '^[a-f0-9]{64}\$'" | tr -d '[:space:]')
if [[ "${BROKEN}" != "0" ]]; then
  echo "в снимках есть повреждённые контрольные суммы" >&2
  exit 1
fi

run_psql "${DATABASE_URL}" -c "drop database ${TARGET_DB}" >/dev/null
echo "репетиция восстановления пройдена"
