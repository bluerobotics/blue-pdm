# BluePLM API Server
# Deploy this image to Railway, Render, Fly.io, etc.
#
# Usage (local):
#   docker run -p 3001:3001 \
#     -e SUPABASE_URL=https://xxx.supabase.co \
#     -e SUPABASE_KEY=your-anon-key \
#     ghcr.io/bluerobotics/blueplm-api:latest
#
# PaaS Deployment (Railway/Render/Fly.io):
#   The app automatically uses the PORT env var provided by the platform.
#   Just set SUPABASE_URL, SUPABASE_KEY, and SUPABASE_SERVICE_KEY.
#
# Railway Service: bluePLM-api
#
# The runtime stage contains only Node, the production dependencies and the
# compiled JavaScript. There is no TypeScript compiler and no tsx, so nothing
# is fetched from the npm registry when a container starts.

# ---------------------------------------------------------------------------
# Build stage: install every dependency and compile api/ to JavaScript.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /build

# api/ is a separate deployable with its own manifest and lockfile. A root
# install never installs it, so the build has to use api/package*.json.
COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/ ./

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage: production dependencies plus the emitted JavaScript.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# Build arg for git commit SHA (passed from CI)
ARG GIT_COMMIT_SHA
ENV BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}

# NODE_ENV is deliberately not set here. It gates CORS (unset means permissive,
# 'production' means deny unless CORS_ORIGINS is given) and the /docs UI, so
# setting it would change how every existing deployment behaves. Whether this
# image should default to production is a separate decision from dropping tsx.

WORKDIR /app

COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# dist/ mirrors the api/ source layout, so unpacking it at the same level as
# package.json keeps every path that server.js and routes/health.js resolve
# relative to their own module URL pointing where it did before the build.
COPY --from=build /build/dist/ ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

# Default port for local dev (PaaS platforms provide PORT dynamically)
ENV PORT=3001
EXPOSE 3001

# Health check uses $PORT for flexibility
# Note: Railway/Render provide their own health checks, this is for local/Docker Compose
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

# --enable-source-maps makes stack traces point at the TypeScript sources,
# which are inlined into the .map files emitted next to each module.
CMD ["node", "--enable-source-maps", "server.js"]
