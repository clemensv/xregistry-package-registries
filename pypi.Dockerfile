# Use official Python 3.11 Alpine image
FROM python:3.11-alpine

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

# Set working directory
WORKDIR /app

# Copy requirements file
COPY pypi/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY pypi/src/ ./src/
COPY shared/ ../shared/

# Create non-root user
RUN addgroup -g 1001 -S python && \
    adduser -S xregistry -u 1001 -G python

# Change ownership of the app directory
RUN chown -R xregistry:python /app
USER xregistry

# Expose port
EXPOSE 3100

# Enhanced health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f -s --max-time 5 http://localhost:3100/health || exit 1

# Start the application
CMD ["python", "src/server.py"] 