# syntax=docker/dockerfile:1

# ---- dependencies -----------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next reads env at runtime for everything server-side; a placeholder is enough
# to satisfy build-time module initialisation.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# ffmpeg encodes the renders. fonts-dejavu-core is not optional alongside it:
# the slim base ships no fonts at all, and ffmpeg's drawtext filter needs a real
# font file, so without this every render fails at the point it draws a heading.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage /app/.next
USER nextjs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
