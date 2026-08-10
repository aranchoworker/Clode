#!/usr/bin/env bash
# 로컬 개발/테스트용 Postgres 클러스터를 띄운다.
#
# Docker 없이 시스템에 설치된 postgres 바이너리를 그대로 쓴다.
# (컨테이너/CI 어디서든 docker daemon 없이 테스트가 돌아가야 하기 때문)
#
# 사용법: bash scripts/dev-db.sh {start|stop|status|reset}
set -euo pipefail

PGPORT="${VOICEALARM_PGPORT:-5433}"
PGDATA="${VOICEALARM_PGDATA:-/var/lib/postgresql/va/data}"
PGUSER_SYS="${VOICEALARM_PGUSER:-postgres}"

find_bindir() {
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  for dir in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql*/bin; do
    if [ -x "$dir/pg_ctl" ]; then
      echo "$dir"
      return
    fi
  done
  echo "pg_ctl 을 찾을 수 없습니다. PostgreSQL 을 설치해 주세요." >&2
  exit 1
}

BINDIR="$(find_bindir)"

# postgres 는 root 로 실행되지 않는다. root 라면 postgres 계정으로 내려간다.
run_pg() {
  if [ "$(id -u)" = "0" ]; then
    su "$PGUSER_SYS" -c "$1"
  else
    bash -c "$1"
  fi
}

start() {
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"
    if [ "$(id -u)" = "0" ]; then
      chown -R "$PGUSER_SYS":"$PGUSER_SYS" "$(dirname "$PGDATA")"
    fi
    run_pg "$BINDIR/initdb -D $PGDATA -U postgres --auth=trust"
  fi

  if run_pg "$BINDIR/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
    echo "이미 실행 중 (port $PGPORT)"
  else
    run_pg "$BINDIR/pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1' -l /tmp/voicealarm-pg.log start"
  fi

  for db in voicealarm voicealarm_test; do
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" \
      | grep -q 1 || psql -h 127.0.0.1 -p "$PGPORT" -U postgres -c "CREATE DATABASE $db"
  done
  echo "준비 완료: postgresql://postgres@127.0.0.1:$PGPORT/voicealarm"
}

case "${1:-start}" in
  start) start ;;
  stop) run_pg "$BINDIR/pg_ctl -D $PGDATA stop -m fast" ;;
  status) run_pg "$BINDIR/pg_ctl -D $PGDATA status" ;;
  reset)
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -c "DROP DATABASE IF EXISTS voicealarm_test"
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -c "CREATE DATABASE voicealarm_test"
    ;;
  *) echo "사용법: $0 {start|stop|status|reset}" >&2; exit 1 ;;
esac
