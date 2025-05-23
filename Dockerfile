# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create cache directories
RUN mkdir -p cache/pypi cache/npm cache/maven cache/nuget cache/oci

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy all server code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S xregistry -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R xregistry:nodejs /app

# Switch to non-root user
USER xregistry

# Expose the default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: 3000, path: '/', timeout: 2000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) process.exit(0); \
      else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Set environment variables
ENV NODE_ENV=production
ENV XREGISTRY_PORT=3000
ENV XREGISTRY_ENABLE=pypi,npm,maven,nuget,oci
ENV XREGISTRY_QUIET=false

# Start the unified server with all registries enabled
CMD ["node", "server.js", "--enable", "pypi,npm,maven,nuget,oci"] 