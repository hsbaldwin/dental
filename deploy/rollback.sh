#!/usr/bin/env bash
# 바로 전 버전으로 되돌리기(급할 때). 점검은 건너뜁니다.
#   deploy/rollback.sh            운영
#   STAGE=staging deploy/rollback.sh
set -euo pipefail
cd "$(dirname "$0")"
STAGE="${STAGE:-production}"
HISTORY=".history-$STAGE"
[ -f "$HISTORY" ] || { echo "배포 기록이 없습니다: deploy/$HISTORY"; exit 1; }
CURRENT="$(cat ".current-$STAGE" 2> /dev/null || true)"
PREV="$(grep -vxF "${CURRENT:-}" "$HISTORY" | tail -n 1 || true)"
[ -n "$PREV" ] || { echo "되돌릴 이전 버전이 없습니다."; exit 1; }
echo "되돌리기: ${CURRENT:-?} → $PREV"
STAGE="$STAGE" PREFLIGHT=off ./deploy.sh "$PREV"
