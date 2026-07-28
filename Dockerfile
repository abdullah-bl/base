# Base BaaS — Minimalistic Backend-as-a-Service
# Single container: Bun runtime + optional Litestream sidecar

FROM oven/bun:1.3 AS base

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p data/uploads

# Expose port
EXPOSE 3000

# Environment defaults
ENV PORT=3000
ENV DATABASE_URL=file:./data/app.db
ENV CORS_ORIGINS=*
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the server
CMD ["bun", "run", "src/index.ts"]
