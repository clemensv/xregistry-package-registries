# Use official Node.js 23 Alpine image
FROM node:25-alpine

# Install diagnostic tools for troubleshooting and bash for restart script
RUN apk add --no-cache \
    curl \
    wget \
    bind-tools \
    jq \
    htop \
    procps \
    bash

# Add image identification
LABEL org.xregistry.name="xregistry-mcp-bridge"
LABEL org.xregistry.description="xRegistry API wrapper for Model Context Protocol (MCP)"

# Create app directory
WORKDIR /app

# Copy package files
COPY mcp/ mcp/
COPY shared/ shared/

WORKDIR /app/mcp
# Install dependencies
RUN npm ci && npm cache clean --force

# Build TypeScript
RUN npm run build

# Install shared logging dependencies
WORKDIR /app/shared/logging
RUN npm install && npm cache clean --force

# Return to service directory
WORKDIR /app/mcp

# Copy restart wrapper script
COPY <<EOF /app/mcp/restart-wrapper.sh
#!/bin/bash

# Set up logging
LOG_FILE="/app/logs/mcp-server.log"
CRASH_LOG_FILE="/app/logs/mcp-crashes.log"
mkdir -p /app/logs

# Function to log with timestamp
log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] \$1" | tee -a "\$LOG_FILE"
}

# Function to log crash details
log_crash() {
    local exit_code=\$1
    local timestamp=\$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "=== CRASH REPORT ===" >> "\$CRASH_LOG_FILE"
    echo "Timestamp: \$timestamp" >> "\$CRASH_LOG_FILE"
    echo "Exit Code: \$exit_code" >> "\$CRASH_LOG_FILE"
    echo "Process ID: \$\$" >> "\$CRASH_LOG_FILE"
    echo "Memory Info:" >> "\$CRASH_LOG_FILE"
    cat /proc/meminfo | head -5 >> "\$CRASH_LOG_FILE" 2>/dev/null || echo "Memory info unavailable" >> "\$CRASH_LOG_FILE"
    echo "Disk Space:" >> "\$CRASH_LOG_FILE"
    df -h /app >> "\$CRASH_LOG_FILE" 2>/dev/null || echo "Disk info unavailable" >> "\$CRASH_LOG_FILE"
    echo "===================" >> "\$CRASH_LOG_FILE"
    echo "" >> "\$CRASH_LOG_FILE"
}

# Main restart loop
RESTART_COUNT=0
MAX_RAPID_RESTARTS=5
RESTART_WINDOW=300  # 5 minutes
RESTART_TIMES=()

log_with_timestamp "MCP server wrapper started"

while true; do
    current_time=\$(date +%s)
    
    # Clean old restart times (outside the window)
    new_restart_times=()
    for restart_time in "\${RESTART_TIMES[@]}"; do
        if [ \$((current_time - restart_time)) -lt \$RESTART_WINDOW ]; then
            new_restart_times+=("\$restart_time")
        fi
    done
    RESTART_TIMES=("\${new_restart_times[@]}")
    
    # Check if we're restarting too rapidly
    if [ \${#RESTART_TIMES[@]} -ge \$MAX_RAPID_RESTARTS ]; then
        log_with_timestamp "ERROR: Too many rapid restarts (\${#RESTART_TIMES[@]} in \${RESTART_WINDOW}s). Waiting 60 seconds before retry..."
        sleep 60
        RESTART_TIMES=()  # Reset the counter
    fi
    
    log_with_timestamp "Starting MCP server (attempt \$((++RESTART_COUNT)))"
    
    # Start the server and capture its exit code
    node dist/server.js 2>&1 | tee -a "\$LOG_FILE"
    EXIT_CODE=\$?
    
    # Record this restart time
    RESTART_TIMES+=("\$current_time")
    
    if [ \$EXIT_CODE -eq 0 ]; then
        log_with_timestamp "MCP server exited normally"
        break
    else
        log_with_timestamp "MCP server crashed with exit code \$EXIT_CODE"
        log_crash \$EXIT_CODE
        
        # Wait before restarting
        sleep 5
        log_with_timestamp "Restarting MCP server..."
    fi
done
EOF

# Make the script executable and fix line endings
RUN chmod +x /app/mcp/restart-wrapper.sh && \
    sed -i 's/\r$//' /app/mcp/restart-wrapper.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S xregistry -u 1001

# Create necessary directories and change ownership of the app directory
RUN mkdir -p /app/logs /app/mcp/cache && \
    chown -R xregistry:nodejs /app
USER xregistry

# Expose port (default 3600, but can be overridden with PORT env var)
EXPOSE 3600

# Enhanced health check - use PORT env var if set, otherwise default to 3600
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD sh -c 'curl -f -s --max-time 5 http://localhost:${PORT:-3600}/ || exit 1'

# Start the application with restart wrapper
CMD ["bash", "/app/mcp/restart-wrapper.sh"]
