# Use official Node.js 23 Alpine image
FROM node:23-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY bridge/ bridge/
COPY shared/ shared/

WORKDIR /app/bridge
# Install all dependencies (including dev dependencies for build)
RUN npm ci && npm cache clean --force

# Build TypeScript
RUN npm run build

# Production stage
FROM node:23-alpine AS production

# Install diagnostic tools for troubleshooting
RUN apk add --no-cache \
    curl \
    wget \
    bind-tools \
    jq \
    htop \
    procps

# Create app directory
WORKDIR /app

# Copy package files
COPY bridge/ bridge/
COPY shared/ shared/

WORKDIR /app/bridge
# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/bridge/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S xregistry -u 1001

# Change ownership of the app directory
RUN chown -R xregistry:nodejs /app
USER xregistry

# Expose port
EXPOSE 8080

# Enhanced health check with better diagnostics
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f -s --max-time 5 http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "dist/proxy.js"] 