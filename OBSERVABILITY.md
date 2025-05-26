# xRegistry Observability Implementation

## Overview

The xRegistry package registries implement structured logging and telemetry
collection using OpenTelemetry standards. All services send telemetry data to
Azure Application Insights for monitoring, debugging, and operational analysis.

## Architecture

### Components

- **OpenTelemetry SDK**: Standardized telemetry collection and export
- **Azure Application Insights**: Telemetry storage and analysis platform
- **Log Analytics Workspace**: Structured log storage with 30-day retention
- **Azure Monitor**: Alerting and dashboard platform

### Data Flow

```
Service → OpenTelemetry SDK → OTLP Exporter → Application Insights → Log Analytics
```

Each service runs OpenTelemetry instrumentation that automatically captures:
- HTTP requests and responses
- Database queries and external API calls
- Exceptions and error details
- Custom application metrics
- Distributed trace context

## Implementation Details

### Shared Logging Library

Location: `/shared/logging/logger.js`

The `XRegistryLogger` class provides OpenTelemetry-conformant logging with the
following features:

- W3C Trace Context propagation
- Structured JSON log format
- Automatic HTTP request instrumentation
- Exception tracking with stack traces
- Custom metrics recording

### Service Integration

Each service (bridge, npm, pypi, maven, nuget, oci) implements the logger:

```javascript
const { createLogger } = require('../shared/logging/logger');

const logger = createLogger({
  serviceName: 'xregistry-npm',
  logLevel: 'info'
});

app.use(logger.middleware());
```

### Log Format

Standard log entries use this structure:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "service": "xregistry-bridge",
  "message": "Package request processed",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "service.name": "xregistry-bridge",
  "service.version": "1.0.0",
  "http.method": "GET",
  "http.status_code": 200,
  "http.url": "/npm/packages/lodash",
  "http.response_time_ms": 245,
  "net.peer.ip": "10.0.0.15"
}
```

## Data Types Collected

### Request Telemetry
- Request URL, method, headers
- Response status codes and timing
- User agent and client IP
- Request and response payload sizes

### Dependency Telemetry
- External API calls to package registries
- Database queries and connection details
- Cache hit/miss rates
- Third-party service response times

### Exception Telemetry
- Exception type and message
- Stack traces with source code context
- Request context when exception occurred
- User impact and error frequency

### Custom Metrics
- Package download counts by registry
- Cache efficiency metrics
- Service health indicators
- Business logic performance counters

### Trace Telemetry
- End-to-end request correlation
- Service boundary crossing timing
- Distributed transaction flow
- Performance bottleneck identification

## Using Azure Application Insights

### Accessing Data

Navigate to the Application Insights resource in the Azure portal. Data appears
in several views:

- **Live Metrics**: Real-time performance counters
- **Application Map**: Service dependency visualization
- **Performance**: Request timing and throughput analysis
- **Failures**: Exception tracking and error analysis
- **Logs**: Raw telemetry data query interface

### Common Queries

#### Request Success Rate by Service

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

#### Error Analysis with Context

```kusto
exceptions
| where timestamp > ago(24h)
| join kind=inner requests on operation_Id
| project 
    timestamp,
    service = cloud_RoleName,
    error_type = type,
    error_message = outerMessage,
    request_url = url,
    user_agent = client_Browser
| order by timestamp desc
```

#### Performance Trending

```kusto
requests
| where timestamp > ago(7d)
| where cloud_RoleName == "xregistry-bridge"
| summarize 
    avg_duration = avg(duration),
    p95_duration = percentile(duration, 95),
    request_count = count()
  by bin(timestamp, 1h)
| render timechart
```

#### Trace Analysis for Slow Requests

```kusto
requests
| where timestamp > ago(1h)
| where duration > 5000
| join kind=inner traces on operation_Id
| project 
    timestamp,
    duration,
    url,
    trace_message = message,
    custom_properties = customDimensions
| order by duration desc
```

### Dependency Analysis

```kusto
dependencies
| where timestamp > ago(1h)
| summarize 
    call_count = count(),
    avg_duration = avg(duration),
    failure_rate = round(100.0 * countif(success == false) / count(), 2)
  by target, type
| order by failure_rate desc
```

## Using Azure Monitor

### Alert Rules

Configure alerts based on telemetry data:

#### High Error Rate Alert
- **Metric**: `requests/failed`
- **Condition**: Count > 10 in 5 minutes
- **Action**: Email notification to operations team

#### Slow Response Time Alert
- **Metric**: `requests/duration`
- **Condition**: Average > 5000ms over 5 minutes
- **Action**: Auto-scale container instances

#### Service Availability Alert
- **Metric**: `availabilityResults/availabilityPercentage`
- **Condition**: < 95% over 10 minutes
- **Action**: SMS notification and incident creation

### Dashboards

Create custom dashboards using these widgets:

#### Service Health Dashboard
- Request rate and success percentage charts
- Active user count and geographic distribution
- Cache hit rates and dependency response times
- Current error rate and exception frequency

#### Performance Dashboard
- Response time percentiles (50th, 95th, 99th)
- Throughput by endpoint and service
- Database query performance metrics
- Memory and CPU utilization trends

#### Business Metrics Dashboard
- Package download counts by registry type
- Most popular packages and versions
- User activity patterns and peak usage times
- Revenue-impacting performance metrics

## Log Analytics Queries

### Container Logs Analysis

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(1h)
| extend LogData = parse_json(Log_s)
| where LogData.level == "ERROR"
| project 
    TimeGenerated,
    Service = ContainerName_s,
    Message = LogData.message,
    TraceId = LogData.trace_id,
    ErrorDetails = LogData.error
| order by TimeGenerated desc
```

### Service Startup Analysis

```kusto
ContainerAppConsoleLogs_CL
| where Log_s contains "Service starting"
| extend LogData = parse_json(Log_s)
| project 
    TimeGenerated,
    Service = ContainerName_s,
    Port = LogData.port,
    ApiKeyEnabled = LogData.apiKeyEnabled
| summarize StartupCount = count() by Service, bin(TimeGenerated, 1h)
```

### Trace Correlation

```kusto
ContainerAppConsoleLogs_CL
| extend LogData = parse_json(Log_s)
| where LogData.trace_id == "specific-trace-id"
| project 
    TimeGenerated,
    Service = ContainerName_s,
    LogLevel = LogData.level,
    Message = LogData.message,
    SpanId = LogData.span_id
| order by TimeGenerated asc
```

## Troubleshooting Common Issues

### High Error Rates

1. Query recent exceptions:
```kusto
exceptions | where timestamp > ago(1h) | summarize count() by type
```

2. Identify affected services:
```kusto
requests | where success == false | summarize count() by cloud_RoleName
```

3. Analyze error patterns:
```kusto
exceptions | where timestamp > ago(1h) | project timestamp, type, outerMessage, operation_Name
```

### Performance Degradation

1. Find slow requests:
```kusto
requests | where duration > 5000 | project timestamp, url, duration, cloud_RoleName
```

2. Analyze dependency performance:
```kusto
dependencies | where duration > 2000 | summarize avg(duration) by target
```

3. Check resource utilization:
```kusto
performanceCounters | where counter == "% Processor Time" | summarize avg(value) by bin(timestamp, 5m)
```

### Service Availability Issues

1. Check service health:
```kusto
requests | summarize availability = 100.0 * countif(success)/count() by cloud_RoleName
```

2. Identify outage periods:
```kusto
availabilityResults | where success == false | project timestamp, location, message
```

3. Correlate with infrastructure events:
```kusto
traces | where message contains "Service shutting down" or message contains "Service starting"
```

## Configuration

### Environment Variables

- `APPLICATIONINSIGHTS_CONNECTION_STRING`: Application Insights connection
  string
- `OTEL_EXPORTER_OTLP_ENDPOINT`: OpenTelemetry collector endpoint
- `OTEL_RESOURCE_ATTRIBUTES`: Service metadata for telemetry
- `LOG_LEVEL`: Minimum log level (error, warn, info, debug)

### Sampling Configuration

Default sampling rates:
- **Traces**: 100% for errors, 10% for successful requests
- **Logs**: 100% for error/warn, 50% for info, 10% for debug
- **Metrics**: 100% collection with 1-minute aggregation

## Data Retention

- **Application Insights**: 90 days default, 730 days maximum
- **Log Analytics**: 30 days configured, up to 2 years available
- **Live Metrics**: 24 hours real-time data
- **Raw Telemetry**: Export to storage for long-term retention

## Security Considerations

### Data Privacy
- Personal identifiers automatically redacted from logs
- API keys and tokens masked in telemetry
- Request/response payloads excluded by default
- GDPR compliance through data purge capabilities

### Access Control
- Role-based access to Application Insights data
- Separate reader/writer permissions for different teams
- Audit logging for telemetry data access
- Network isolation for telemetry collection endpoints

## Cost Management

### Typical Monthly Costs
- **Application Insights**: $50-150 based on data volume
- **Log Analytics**: $20-80 for 30-day retention
- **Storage**: $10-30 for exported telemetry data

### Cost Optimization
- Adjust sampling rates based on traffic patterns
- Use smart detection to reduce alert noise
- Configure data retention based on compliance requirements
- Export historical data to cheaper storage tiers 