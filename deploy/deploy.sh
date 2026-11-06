#!/usr/bin/env bash
# W치과 배포: 점검 → 배포 전 백업 → 새 버전으로 교체 → 상태 확인 → 실패하면 이전 버전으로 자동 되돌림
#
#   deploy/deploy.sh v1.2.0                  운영 (production.env, 127.0.0.1:3000, 오픈 전 점검 --strict)
#   STAGE=staging deploy/deploy.sh v1.2.0    스테이징 (staging.env, 127.0.0.1:3100, 기본 점검)
#
# 환경변수(선택)
#   PREFLIGHT=strict|basic|off   점검 수준 (운영 기본 strict, 스테이징 basic)
#   APP_IMAGE=...                이미지 이름 (기본 ghcr.io/hsbaldwin/dental)
#   SKIP_PULL=1                  이미지를 받지 않고 서버에 있는 것으로 (CI · 직접 빌드)
#   HEALTH_WAIT=60               새 버전이 정상인지 기다리는 시간(초)
#
# 마이그레이션은 '추가'만 하므로(server/db.js) 앱만 되돌려도 이전 버전이 같은 DB로 돈다.
# 데이터 자체가 망가졌을 때만 배포 전 백업으로 복구(docs/production.md '복구').
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?배포할 버전을 주세요. 예: deploy/deploy.sh v1.2.0}"
STAGE="${STAGE:-production}"
case "$STAGE" in
  production) PROJECT=w-dental;         DEF_ENV=./production.env; DEF_PORT=3000; DEF_PRE=strict ;;
  staging)    PROJECT=w-dental-staging; DEF_ENV=./staging.env;    DEF_PORT=3100; DEF_PRE=basic ;;
  *)          PROJECT="w-dental-$STAGE"; DEF_ENV="./$STAGE.env";   DEF_PORT=3200; DEF_PRE=off ;;
esac
export TAG ENV_FILE="${ENV_FILE:-$DEF_ENV}" APP_PORT="${APP_PORT:-$DEF_PORT}"
PREFLIGHT="${PREFLIGHT:-$DEF_PRE}"
HEALTH_WAIT="${HEALTH_WAIT:-60}"
STATE=".current-$STAGE"
HISTORY=".history-$STAGE"
NODE="node --disable-warning=ExperimentalWarning"

[ -f "$ENV_FILE" ] || { echo "설정 파일이 없습니다: deploy/$ENV_FILE (deploy/env.$STAGE.example을 복사해 채우세요)"; exit 1; }
compose() { docker compose -p "$PROJECT" -f compose.yaml "$@"; }
log() { printf '[%s] [%s] %s\n' "$(date '+%F %T')" "$STAGE" "$*"; }
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }
notify() {
  local url; url="$(envval NOTIFY_WEBHOOK_URL)"
  [ -n "$url" ] || return 0
  curl -fsS -m 5 -H 'content-type: application/json' -d "{\"text\":\"[배포 · $STAGE] $1\"}" "$url" > /dev/null || true
}
running() { [ -n "$(compose ps -q --status running app 2> /dev/null)" ]; }
# 컨테이너 안에서 상태 확인(127.0.0.1이라 운영 정보까지 보임)을 불러 ok + 기대한 버전인지 확인
healthy() {
  local want="$1" body
  body="$(compose exec -T app wget -qO- http://127.0.0.1:3000/api/health 2> /dev/null)" || return 1
  [[ "$body" == *'"ok":true'* && "$body" == *"\"version\":\"$want\""* ]]
}
wait_healthy() {
  local want="$1" i
  for ((i = 0; i < HEALTH_WAIT; i += 2)); do healthy "$want" && return 0; sleep 2; done
  return 1
}

PREV="$(cat "$STATE" 2> /dev/null || true)"
log "배포 시작: ${PREV:-(처음)} → $TAG"

# 1) 이미지 받기
if [ "${SKIP_PULL:-0}" != 1 ]; then compose pull app; fi

# 2) 배포 전 백업 (지금 돌고 있는 버전으로, 마이그레이션 전에)
if running; then
  compose exec -T app $NODE scripts/backup.js --tag "pre-deploy-$TAG" --no-rotate
else
  log "돌고 있는 앱이 없어 배포 전 백업을 건너뜁니다(첫 배포)."
fi

# 3) 오픈 전 점검 (새 버전으로, 앱을 바꾸기 전에)
if [ "$PREFLIGHT" != off ]; then
  args=(); [ "$PREFLIGHT" = strict ] && args=(--strict)
  if ! compose run --rm --no-deps -T app $NODE scripts/preflight.js "${args[@]}"; then
    log "점검에서 막혔습니다. 배포하지 않았습니다(지금 버전 ${PREV:-없음} 그대로)."
    notify "$TAG 배포 중단 — 오픈 전 점검에서 막힘"
    exit 1
  fi
fi

# 4) 교체 → 상태 확인
compose up -d --no-deps app
if wait_healthy "$TAG"; then
  echo "$TAG" > "$STATE"; echo "$TAG" >> "$HISTORY"
  log "배포 완료: $TAG"
  notify "$TAG 배포 완료"
  exit 0
fi

# 5) 실패 → 자동 되돌림
log "새 버전 $TAG 이(가) ${HEALTH_WAIT}초 안에 정상 응답하지 않았습니다. 최근 기록:"
compose logs --tail 30 app || true
if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
  log "이전 버전 $PREV 으로 되돌립니다."
  TAG="$PREV" compose up -d --no-deps app
  if TAG="$PREV" wait_healthy "$PREV"; then
    log "되돌림 완료: $PREV"
    notify "$TAG 배포 실패 → $PREV 로 자동 되돌림 완료"
  else
    log "되돌림도 정상 응답이 없습니다. 바로 확인이 필요합니다(docs/production.md '장애 대응')."
    notify "$TAG 배포 실패, $PREV 되돌림도 실패 — 바로 확인 필요"
  fi
else
  notify "$TAG 배포 실패 — 되돌릴 이전 버전 없음"
fi
exit 1
