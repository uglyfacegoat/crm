FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN find .next/standalone -type f -name '*.test.*' -delete

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache postgresql17-client \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/zod ./node_modules/zod
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/fflate ./node_modules/fflate
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/safe-cli-error.mjs ./scripts/safe-cli-error.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-drain.mjs ./scripts/file-write-drain.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-recovery.mjs ./scripts/file-write-recovery.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-quarantine.mjs ./scripts/file-write-quarantine.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-quarantine-export.mjs ./scripts/file-write-quarantine-export.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-s3-export.mjs ./scripts/file-write-s3-export.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-s3-quarantine.mjs ./scripts/file-write-s3-quarantine.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/file-write-s3-restore.mjs ./scripts/file-write-s3-restore.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/storage-transfer.mjs ./scripts/storage-transfer.mjs
COPY --from=builder --chown=nextjs:nodejs /app/src/server/file-writes/lock-key.mjs ./src/server/file-writes/lock-key.mjs
COPY --from=builder --chown=nextjs:nodejs /app/src/server/file-writes/gate.mjs ./src/server/file-writes/gate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/src/server/file-scan/clamd.mjs /app/src/server/file-scan/zip-bounds.mjs ./src/server/file-scan/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/validate-runtime-config.mjs ./scripts/validate-runtime-config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/src/server/config/environment.ts ./src/server/config/environment.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/server/storage ./src/server/storage
COPY --from=builder --chown=nextjs:nodejs /app/scripts/seed-local-example-data.mjs ./scripts/seed-local-example-data.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/reminder-worker.mjs /app/scripts/reminder-worker-config.mjs /app/scripts/worker-runtime-config.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backup-worker.mjs /app/scripts/backup-worker-config.mjs /app/scripts/backup-process.mjs /app/scripts/backup-restore.mjs /app/scripts/backup-restore-check.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backup-integrity.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backup-export.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backup-retention.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/storage-audit.mjs /app/scripts/s3-audit-storage.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backup-snapshot.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/storage /app/backups \
  && chown nextjs:nodejs /app/storage /app/backups \
  && chmod 0700 /app/storage /app/backups \
  && chmod 0555 ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
