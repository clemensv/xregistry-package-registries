# Use official Node.js 23 Alpine image
FROM node:23-alpine

# Install diagnostic tools for troubleshooting
RUN apk add --no-cache \
    curl \
    wget \
    bind-tools \
    jq \
    htop \
    procps

# Add image identification
LABEL org.xregistry.name="xregistry-npm-bridge"
LABEL org.xregistry.description="xRegistry API wrapper for NPM"

# Create app directory
WORKDIR /app

# Copy package files
COPY npm/ npm/
COPY shared/ shared/

WORKDIR /app/npm
# Install dependencies
RUN npm ci && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S xregistry -u 1001

# Change ownership of the app directory
RUN chown -R xregistry:nodejs /app
USER xregistry

# Expose port
EXPOSE 3000

# Enhanced health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f -s --max-time 5 http://localhost:3000/health || exit 1

# Start the application  
CMD ["node", "server.js"] 