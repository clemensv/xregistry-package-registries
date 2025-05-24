# Resilient Bridge Startup

The bridge has been enhanced to handle timing issues during startup by implementing resilient initialization with retry logic and timeout controls.

## Features

### 1. Graceful Handling of Unavailable Servers
- The bridge no longer exits immediately if downstream servers are unavailable during startup
- It attempts to connect to each server with retry logic and timeouts
- The bridge will start successfully even if some servers are unavailable

### 2. Configurable Timeout and Retry Parameters

#### Environment Variables
- `INITIALIZATION_TIMEOUT`: Total time to wait for all servers (default: 120000ms = 120 seconds)
- `RETRY_INITIAL_DELAY`: Initial delay between retries (default: 1000ms = 1 second)
- `RETRY_MAX_DELAY`: Maximum delay between retries (default: 10000ms = 10 seconds)
- `RETRY_BACKOFF_FACTOR`: Exponential backoff multiplier (default: 2.0)

#### Example Configuration
```bash
# Wait up to 3 minutes for servers to become available
INITIALIZATION_TIMEOUT=180000

# Start with 2-second delays between retries
RETRY_INITIAL_DELAY=2000

# Cap retry delays at 15 seconds
RETRY_MAX_DELAY=15000

# Use a more aggressive backoff factor
RETRY_BACKOFF_FACTOR=2.5
```

### 3. Exponential Backoff Retry Logic
- Retries start with the initial delay
- Each subsequent retry doubles the delay (configurable via backoff factor)
- Delays are capped at the maximum delay setting
- Continues retrying until the total timeout is reached

### 4. Startup Behavior
- **All servers available**: Normal startup, all registry types accessible
- **Some servers unavailable**: Partial startup, only available registry types accessible
- **No servers available**: Bridge exits with error code 1

### 5. Health Check Endpoint
A new `/health` endpoint provides real-time status of all downstream servers:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "downstreams": [
    {
      "url": "http://localhost:4873",
      "healthy": true,
      "initialized": true,
      "groups": ["npm"]
    },
    {
      "url": "http://localhost:3000",
      "healthy": false,
      "initialized": false,
      "groups": []
    }
  ],
  "consolidatedGroups": ["npm", "pypi", "maven"]
}
```

#### Health Check Status Codes
- `200`: At least one server is healthy and initialized
- `503`: No servers are healthy and initialized

## Logging

The bridge provides detailed logging during initialization:

```
Starting bridge initialization with 120s timeout...
Initializing server http://localhost:4873...
Successfully initialized server http://localhost:4873
✓ Server http://localhost:4873 initialized successfully

Initializing server http://localhost:3000...
Failed to initialize http://localhost:3000: connect ECONNREFUSED 127.0.0.1:3000
Retrying in 1000ms... (119s remaining)
Attempt 1 failed, retrying in 1000ms...
Failed to initialize http://localhost:3000: connect ECONNREFUSED 127.0.0.1:3000
Retrying in 1000ms... (117s remaining)
...
Timeout reached for server http://localhost:3000 after 120000ms
✗ Server http://localhost:3000 failed to initialize within timeout period

Initialization complete: 4 servers available, 1 servers unavailable
Bridge started with 1 unavailable servers. Some registry types may not be accessible.
xRegistry Proxy running at http://localhost:8080
```

## Best Practices

1. **Set appropriate timeouts**: Consider your deployment environment and expected startup times
2. **Monitor health endpoint**: Use the `/health` endpoint for readiness probes
3. **Configure retry parameters**: Adjust based on network conditions and server startup characteristics
4. **Plan for partial availability**: Design clients to handle cases where some registry types may be unavailable

## Migration from Previous Version

The changes are backward compatible. Existing deployments will use the default timeout and retry settings without requiring configuration changes.

To enable custom behavior, simply set the environment variables as needed in your deployment configuration. 