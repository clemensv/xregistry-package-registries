# xRegistry Observability Implementation

## Overview

The xRegistry package registries implement basic structured logging using a
custom logging library. The logging infrastructure is prepared for Azure
Application Insights integration through deployment configuration, but uses a
simple JSON logging format.

## Architecture

### Components

- **Custom Logger**: Simple structured logging library
  (`shared/logging/logger.js`)
- **Azure Application Insights**: Configured in deployment for telemetry
  collection
- **Log Analytics Workspace**: Structured log storage with 30-day retention
  (deployment configuration)
- **Azure Monitor**: Alerting and dashboard platform (deployment configuration)

### Data Flow

```
Service → Custom Logger → JSON Logs → (Manual Integration) → Application Insights → Log Analytics
```

Each service uses the custom logger that captures:
- HTTP requests and responses
- Service startup and shutdown events
- Error messages with stack traces
- Custom application events
- Request correlation through request IDs

## Implementation Details

### Shared Logging Library

Location: `/shared/logging/logger.js`

The `XRegistryLogger` class provides structured logging with these features:

- Structured JSON log format
- Express middleware for automatic request logging
- File and console output options
- Request correlation through generated request IDs
- Error tracking with stack traces

**Note**: Despite the package.json description mentioning OpenTelemetry, the
actual implementation uses basic structured logging without OpenTelemetry SDK
integration.

### Service Integration

Each service (bridge, npm, pypi, maven, nuget, oci) implements the logger:

```javascript
const { createLogger } = require('../shared/logging/logger');

const logger = createLogger({
  serviceName: 'xregistry-npm',
  serviceVersion: '1.0.0',
  environment: 'production',
  enableFile: false,
  enableConsole: true
});

app.use(logger.middleware());
```

### Actual Log Format

Standard log entries use this structure:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "message": "Request completed",
  "service": "xregistry-npm",
  "version": "1.0.0",
  "environment": "production",
  "hostname": "container-hostname",
  "pid": 1,
  "requestId": "abc123def",
  "method": "GET",
  "url": "/npm/packages/lodash",
  "statusCode": 200,
  "duration": 245
}
```

## Data Types Collected

### Request Telemetry
- Request method, URL, and completion status
- Response status codes and timing
- User agent and request headers
- Generated request ID for correlation

### Application Events
- Service startup and shutdown events
- Health check results
- Dependency call results
- Custom application messages

### Error Information
- Exception type and message
- Stack traces with source context
- Request context when errors occur
- Error frequency tracking

### Performance Data
- Request duration timing
- Dependency call timing
- Service health indicators
- Resource utilization (basic)

## Deployment Configuration

### Azure Application Insights Integration

The deployment infrastructure configures Application Insights integration:

**Bicep Template** (`deploy/main.bicep`):
- Creates Application Insights resource
- Configures connection string as container secret
- Sets up Log Analytics workspace
- Creates monitoring alerts

**Environment Variables Set by Deployment**:
- `APPLICATIONINSIGHTS_CONNECTION_STRING`: Application Insights connection
  string
- `APPLICATIONINSIGHTS_INSTRUMENTATION_KEY`: Instrumentation key for telemetry
- `SERVICE_NAME`: Service identifier for telemetry
- `LOG_LEVEL`: Minimum log level (error, warn, info, debug)

### Container Apps Configuration

Each container is configured with:
- Application Insights connection string
- Service-specific environment variables
- Health check endpoints
- Resource limits and scaling rules

## Log Analysis

### Container Logs in Log Analytics

Query structured logs from containers:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(1h)
| extend LogData = parse_json(Log_s)
| where LogData.level == "ERROR"
| project 
    TimeGenerated,
    Service = ContainerName_s,    
    Message = LogData.message,
    RequestId = LogData.requestId,
    ErrorDetails = LogData.error
| order by TimeGenerated desc
```

### Service Health Analysis

```kusto
ContainerAppConsoleLogs_CL
| where Log_s contains "Service started"
| extend LogData = parse_json(Log_s)
| project 
    TimeGenerated,
    Service = ContainerName_s,
    Port = LogData.port,
    Environment = LogData.environment
| summarize StartupCount = count() by Service, bin(TimeGenerated, 1h)
```

### Request Correlation

```kusto
ContainerAppConsoleLogs_CL
| extend LogData = parse_json(Log_s)
| where LogData.requestId == "specific-request-id"
| project 
    TimeGenerated,
    Service = ContainerName_s,
    LogLevel = LogData.level,
    Message = LogData.message,
    Method = LogData.method,
    URL = LogData.url
| order by TimeGenerated asc
```

## Available Monitoring (Post-Deployment)

### If Application Insights is Connected

Once deployed with Application Insights connection:

#### Basic Request Tracking
```kusto
requests
| where timestamp > ago(1h)
| summarize 
    total = count(),
    successful = countif(success == true),
    failure_rate = round(100.0 * countif(success == false) / count(), 2)
  by cloud_RoleName
| order by failure_rate desc
```

#### Performance Analysis
```kusto
requests
| where timestamp > ago(24h)
| summarize 
    avg_duration = avg(duration),
    p95_duration = percentile(duration, 95),
    request_count = count()
  by bin(timestamp, 1h)
| render timechart
```

### Alert Rules (Configured in Deployment)

The deployment sets up these monitoring alerts:

#### Service Health Alert
- **Condition**: No active container replicas
- **Threshold**: < 1 replica for 5 minutes
- **Action**: Email notification

#### Error Rate Alert  
- **Condition**: High error rate in logs
- **Threshold**: Configurable based on log analysis
- **Action**: Email notification

#### Response Time Alert
- **Condition**: Slow response times detected
- **Threshold**: Configurable performance thresholds
- **Action**: Email notification

## Troubleshooting

### High Error Rates

1. Check recent error logs:
```kusto
ContainerAppConsoleLogs_CL
| extend LogData = parse_json(Log_s)
| where LogData.level == "ERROR"
| summarize count() by LogData.service, LogData.message
```

2. Analyze error patterns:
```kusto
ContainerAppConsoleLogs_CL
| extend LogData = parse_json(Log_s)
| where LogData.level == "ERROR"
| project TimeGenerated, Service = LogData.service, Message = LogData.message
| order by TimeGenerated desc
```

### Performance Issues

1. Find slow requests:
```kusto
ContainerAppConsoleLogs_CL
| extend LogData = parse_json(Log_s)
| where LogData.duration > 5000
| project TimeGenerated, Service = LogData.service, Duration = LogData.duration, URL = LogData.url
```

2. Check service startup issues:
```kusto
ContainerAppConsoleLogs_CL
| where Log_s contains "Service started" or Log_s contains "Error"
| extend LogData = parse_json(Log_s)
| project TimeGenerated, Service = ContainerName_s, Level = LogData.level, Message = LogData.message
```

### Service Availability

1. Check service health:
```kusto
ContainerAppConsoleLogs_CL
| extend LogData = parse_json(Log_s)
| where LogData.message contains "Service started" or LogData.message contains "Service shutting down"
| project TimeGenerated, Service = LogData.service, Event = LogData.message
| order by TimeGenerated desc
```

## Current Limitations

### No OpenTelemetry Integration
- The logger uses basic structured logging, not OpenTelemetry SDK
- No automatic trace correlation or distributed tracing
- No span creation or W3C Trace Context propagation
- Manual correlation only through request IDs

### Manual Application Insights Integration
- Deployment configures Application Insights connection
- Actual telemetry export requires manual implementation
- Log analysis primarily through Log Analytics queries
- No automatic metrics or dependency tracking

### Basic Error Tracking
- Error logging includes stack traces
- No automatic error aggregation or smart detection
- Manual correlation of errors with requests
- Limited context for debugging complex issues

## Configuration

### Logging Configuration

Environment variables for logging behavior:
- `LOG_LEVEL`: Controls minimum log level (error, warn, info, debug)
- `SERVICE_NAME`: Identifies the service in logs
- `NODE_ENV`: Environment identifier (production, development)

### File Logging (Optional)

Services can enable file logging:
```javascript
const logger = createLogger({
  enableFile: true,
  logFile: '/app/logs/service.log'
});
```

## Data Retention

- **Container Logs**: 30 days in Log Analytics (configured in deployment)
- **Application Insights**: 90 days default (if connected)
- **File Logs**: Local to container, lost on restart

## Security Considerations

### Data Privacy
- Request bodies and sensitive headers not logged by default
- API keys and tokens not included in structured logs
- Error messages may contain sensitive information in stack traces

### Access Control
- Log access through Azure RBAC permissions
- Container logs readable by Log Analytics readers
- Application Insights data requires separate permissions

## Cost Implications

### Current Implementation
- **Log Analytics**: $20-80/month for container logs
- **Application Insights**: $0 (not actively sending telemetry)
- **Storage**: Minimal for basic logging

### If Full Application Insights Integration Added
- **Application Insights**: $50-150/month for active telemetry
- **Enhanced monitoring**: Higher cost but better observability 