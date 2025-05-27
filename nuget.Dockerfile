# Use official Node.js 18 Alpine image
FROM node:18-alpine

# Install diagnostic tools for troubleshooting
RUN apk add --no-cache \
    curl \
    wget \
    netstat-nat \
    busybox-extras \
    bind-tools \
    jq \
    htop \
    procps

# Create app directory
WORKDIR /app

# Copy package files
COPY nuget/package*.json ./

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy application code
COPY nuget/src/ ./src/
COPY shared/ ../shared/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S xregistry -u 1001

# Change ownership of the app directory
RUN chown -R xregistry:nodejs /app
USER xregistry

# Expose port
EXPOSE 3300

# Enhanced health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f -s --max-time 5 http://localhost:3300/health || exit 1

# Start the application
CMD ["node", "src/server.js"] 