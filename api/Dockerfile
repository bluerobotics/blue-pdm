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

FROM node:22-alpine

# Build arg for git commit SHA (passed from CI)
ARG GIT_COMMIT_SHA
ENV BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}

WORKDIR /app

# Install API dependencies first (for caching)
COPY api/package*.json ./api/
RUN cd api && npm ci --omit=dev && npm cache clean --force

# Copy API and required source files
COPY api/ ./api/
COPY src/lib/ ./src/lib/
COPY src/types/ ./src/types/
COPY tsconfig.json ./

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

# Start server (uses PORT env var automatically)
CMD ["npx", "tsx", "api/server.ts"]
