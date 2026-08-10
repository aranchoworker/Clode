#!/usr/bin/env bash
# 테스트는 실제 Postgres 에 대해 돌린다.
#
# 인메모리 스텁으로 대체하지 않는 이유: 이 단계에서 검증해야 하는 것이
# "친구 수락 없이는 못 보낸다 / 차단하면 못 보낸다" 같은 관계 규칙이고,
# 그 규칙은 UNIQUE 제약과 트랜잭션 동작에 의존하기 때문이다.
set -euo pipefail

cd "$(dirname "$0")/.."

export NODE_ENV=test
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@127.0.0.1:5433/voicealarm_test?schema=public}"
export DATABASE_URL="$TEST_DATABASE_URL"
export JWT_SECRET="${JWT_SECRET:-test-secret-value-that-is-long-enough-0123456789}"

# 업로드 테스트가 실제 파일을 쓰므로 매 실행마다 새 임시 디렉터리를 준다.
# 저장소 안(.storage)에 쓰면 테스트 잔여물이 쌓이고 커밋에 섞일 위험이 있다.
STORAGE_TMP="$(mktemp -d -t voicealarm-storage-XXXXXX)"
export STORAGE_LOCAL_DIR="$STORAGE_TMP"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://localhost:3000}"
trap 'rm -rf "$STORAGE_TMP"' EXIT

bash scripts/dev-db.sh start >/dev/null

# 테스트 DB 스키마를 스키마 파일과 강제로 일치시킨다(마이그레이션 히스토리 무관).
npx prisma db push --skip-generate --accept-data-loss >/dev/null

npx vitest run "$@"
