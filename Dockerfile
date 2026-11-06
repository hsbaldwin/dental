# W치과 운영 이미지. 런타임은 정확한 버전으로 고정합니다(node:sqlite 사용 — 올릴 때는 테스트 후, 연 1회 점검 때).
FROM node:22.23.4-alpine
LABEL org.opencontainers.image.source="https://github.com/hsbaldwin/dental" \
      org.opencontainers.image.description="W치과 홈페이지 · 예약 · 관리 화면"
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/wdental.db BACKUP_DIR=/data/backups APP_VERSION=${APP_VERSION}
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
