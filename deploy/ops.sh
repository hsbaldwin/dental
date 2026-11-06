#!/usr/bin/env bash
# 운영 도우미 — 지금 돌고 있는 버전으로 명령을 실행합니다.  STAGE=staging 이면 스테이징.
#   deploy/ops.sh status            버전 · DB · 마지막 백업 · 최근 24시간 문자 실패
#   deploy/ops.sh preflight         오픈 기준 점검(--strict). 오픈 전 · 운영 배포 전에 통과해야 함
#   deploy/ops.sh backup            지금 백업(암호화 · 보관 규칙 정리 포함)
#   deploy/ops.sh verify            가장 최근 백업을 풀어 검사만(복구 연습)
#   deploy/ops.sh restore <파일명>  앱을 멈추고 /data/backups/<파일명>으로 복구한 뒤 다시 켬
#   deploy/ops.sh logs              최근 기록 100줄
set -euo pipefail
cd "$(dirname "$0")"
STAGE="${STAGE:-production}"
case "$STAGE" in
  production) PROJECT=w-dental;         DEF_ENV=./production.env; DEF_PORT=3000 ;;
  staging)    PROJECT=w-dental-staging; DEF_ENV=./staging.env;    DEF_PORT=3100 ;;
  *)          PROJECT="w-dental-$STAGE"; DEF_ENV="./$STAGE.env";   DEF_PORT=3200 ;;
esac
TAG="$(cat ".current-$STAGE" 2> /dev/null || true)"
[ -n "$TAG" ] || { echo "배포 기록이 없습니다(deploy/.current-$STAGE). 먼저 deploy.sh로 배포하세요."; exit 1; }
export TAG ENV_FILE="${ENV_FILE:-$DEF_ENV}" APP_PORT="${APP_PORT:-$DEF_PORT}"
compose() { docker compose -p "$PROJECT" -f compose.yaml "$@"; }
NODE="node --disable-warning=ExperimentalWarning"

case "${1:-}" in
  status)    compose exec -T app wget -qO- http://127.0.0.1:3000/api/health; echo ;;
  preflight) compose exec -T app $NODE scripts/preflight.js --strict ;;
  backup)    compose exec -T app $NODE scripts/backup.js ;;
  verify)    compose exec -T app sh -c "$NODE scripts/restore.js \"\$(ls -t /data/backups/wdental-*.db* | head -n 1)\" --verify" ;;
  restore)
    FILE="$(basename "${2:?복구할 백업 파일 이름을 주세요(예: wdental-20261106-0310.db.enc)}")"
    echo "앱을 멈추고 $FILE 으로 복구합니다. 현재 DB는 /data 안에 before-restore 이름으로 남습니다."
    compose stop app
    if compose run --rm --no-deps -T app $NODE scripts/restore.js "/data/backups/$FILE"; then compose start app; else compose start app; exit 1; fi
    ;;
  logs)      compose logs --tail 100 app ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
