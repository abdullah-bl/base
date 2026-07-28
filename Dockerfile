# Base BaaS — Bun runtime + optional Litestream sidecar
FROM oven/bun:1.3 AS base

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# Build admin UI into src/admin/dist
RUN bun run build:admin || true

RUN mkdir -p data/uploads data/backups

EXPOSE 3000

ENV PORT=3000
ENV DATABASE_URL=file:./data/app.db
ENV NODE_ENV=production
ENV HARD_DELETE_ENABLED=false
ENV ADMIN_ENABLED=true

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+process.env.PORT+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]

# ── Litestream sidecar image (optional) ──────────────────────
FROM litestream/litestream:0.3 AS litestream
COPY litestream.yml /etc/litestream.yml
ENTRYPOINT ["litestream"]
CMD ["replicate", "-config", "/etc/litestream.yml"]
