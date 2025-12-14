# BluePDM API Server
# Deploy this image to Railway, Render, Fly.io, etc.
#
# Usage:
#   docker run -p 3001:3001 \
#     -e SUPABASE_URL=https://xxx.supabase.co \
#     -e SUPABASE_KEY=your-anon-key \
#     ghcr.io/bluerobotics/bluepdm-api:latest

FROM node:20-alpine

# Build arg for git commit SHA (passed from CI)
ARG GIT_COMMIT_SHA
ENV BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}

WORKDIR /app

# Install dependencies first (for caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

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

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start server
CMD ["npx", "tsx", "api/server.ts"]
