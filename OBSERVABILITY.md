# xRegistry Observability Strategy

## Overview

This document outlines the comprehensive observability strategy implemented for the xRegistry application, covering deployment automation, **OpenTelemetry-conformant structured logging**, and Azure Application Insights integration.

## 🚀 Key Achievements

### 1. Infrastructure-as-Code Deployment Refactoring

**✅ COMPLETED**: Extracted deployment logic into reusable, parameterized scripts and templates.

#### Files Created:
- `/deploy/main.bicep` - Complete Bicep template with Application Insights, Log Analytics, and alerts
- `/deploy/parameters.json` - Template for deployment parameters
- `/deploy/deploy.sh` - Bash deployment script (Linux/macOS/WSL)
- `/deploy/deploy.ps1` - PowerShell deployment script (Windows/Cross-platform)
- `/deploy/README.md` - Comprehensive deployment documentation

#### Benefits:
- **Reusable deployment scripts** with parameter validation and error handling
- **Cross-platform support** (Bash and PowerShell)
- **Comprehensive error handling** with retry logic and health checks
- **FQDN resolution** for proper service configuration
- **Dry-run capability** for testing deployments
- **Automated testing** of deployed endpoints

#### Usage:
```bash
# Linux/macOS/WSL
./deploy/deploy.sh --repository "owner/repo" --github-actor "user" --github-token "token"

# Windows PowerShell
.\deploy\deploy.ps1 -RepositoryName "owner/repo" -GitHubActor "user" -GitHubToken "token"
```

### 2. Azure Application Insights Integration

**✅ COMPLETED**: Full observability stack with Azure cloud-native monitoring.

#### Infrastructure Components:
- **Application Insights** - Application performance monitoring and telemetry
- **Log Analytics Workspace** - Centralized logging with 30-day retention
- **Action Groups** - Email notifications to `clemensv@microsoft.com`
- **Metric Alerts** - Operational alerts for critical issues

#### Alert Configuration:
1. **Service Health Alert** - Triggers when no container replicas are running
2. **Error Rate Alert** - Triggers on >10 5xx errors in 5 minutes
3. **Response Time Alert** - Triggers on >5 second average response time

#### Monitoring Capabilities:
- **Request tracking** - All HTTP requests across all services
- **Dependency tracking** - External API calls and integrations
- **Performance metrics** - CPU, memory, request rates, response times
- **Exception tracking** - Automatic error capture and stack traces
- **Custom telemetry** - Application-specific metrics and events
- **Distributed tracing** - End-to-end request correlation across services

### 3. OpenTelemetry-Conformant Logging Implementation

**✅ COMPLETED**: Industry-standard OpenTelemetry logging with Azure Application Insights integration.

#### Shared Logging Library:
- `/shared/logging/logger.js` - OpenTelemetry-conformant XRegistryLogger class
- `/shared/logging/package.json` - Package definition with OpenTelemetry dependencies

#### OpenTelemetry Compliance Features:
- **W3C Trace Context propagation** for proper distributed tracing
- **OpenTelemetry semantic conventions** for standardized attribute naming
- **Proper span context correlation** between logs and traces
- **OTLP exporters** for Azure Application Insights integration
- **Resource detection** with cloud platform metadata
- **Structured JSON logging** with OTel severity levels
- **Automatic instrumentation** for HTTP requests, dependencies, and errors
- **Backward compatibility** with existing API for smooth transition

#### Log Format (OpenTelemetry-Conformant):
```json
{
  "timestamp": "2024-05-25T07:17:00.000Z",
  "level": "INFO",
  "service": "xregistry-bridge", 
  "message": "HTTP request received",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "service.name": "xregistry-bridge",
  "service.version": "1.0.0",
  "deployment.environment": "production",
  "http.method": "GET",
  "http.url": "/model",
  "http.user_agent": "curl/7.68.0",
  "net.peer.ip": "192.168.1.100"
}
```

## 📊 Current Implementation Status

### Bridge Service (JavaScript) - ✅ READY FOR OTEL
**Implementation:**
```javascript
// bridge/src/proxy.js (or similar)
const { createLogger } = require('../../shared/logging/logger');

const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'xregistry-bridge',
  logLevel: process.env.LOG_LEVEL || 'info'
});

// Replace morgan middleware
app.use(logger.middleware());

// Replace console.log calls
logger.info('Bridge service starting', { port: PORT, baseUrl: BASE_URL });
logger.error('Downstream service error', { error: error.message, service: serviceName });
```

### Package Services (JavaScript) - ✅ READY FOR OTEL
**Implementation for npm, pypi, maven, nuget, oci:**
```javascript
// {service}/server.js
const { createLogger } = require('../shared/logging/logger');

const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'xregistry-npm',
  logLevel: process.env.LOG_LEVEL || 'info',
  enableFile: !!LOG_FILE,
  logFile: LOG_FILE
});

// Replace existing logging
app.use(logger.middleware());

// Replace custom logRequest function
logger.logStartup(PORT, { apiKeyEnabled: !!API_KEY, baseUrl: BASE_URL });
logger.error('Package fetch failed', { packageName, error: error.message });
```

## 🔧 OpenTelemetry Implementation Benefits

### Standards Compliance:
- **W3C Trace Context** for interoperable distributed tracing
- **OpenTelemetry semantic conventions** for consistent attribute naming
- **Industry-standard APIs** for logging, tracing, and metrics
- **Vendor-neutral implementation** with Azure-specific exporters
- **Future-proof architecture** with CNCF-governed standards

### Enhanced Observability:
- **Automatic span creation** for all HTTP requests
- **Trace-log correlation** for complete request visibility
- **Performance metrics** with OpenTelemetry histograms and counters
- **Resource detection** for cloud platform and service metadata
- **Error tracking** with proper exception recording in spans

### Developer Experience:
- **Backward compatibility** with existing logging API
- **Rich development console output** with trace IDs
- **File logging support** for legacy requirements
- **Express middleware integration** for automatic request tracking
- **Child logger support** for contextual logging

## 📈 Observability Benefits

### For Developers:
- **Standards-based tracing** with W3C Trace Context compatibility
- **Rich span context** automatically correlated with logs
- **OpenTelemetry ecosystem** compatibility for tooling and integrations
- **Consistent semantic conventions** across all services
- **Enhanced debugging** with complete request traces

### For Operations:
- **Industry-standard observability** with OpenTelemetry APIs
- **Vendor flexibility** with OTLP exporters
- **Rich telemetry data** automatically exported to Azure Application Insights
- **Standardized metrics** following OpenTelemetry conventions
- **Compliance-ready** observability with CNCF standards

### For Business:
- **Future-proof observability** with industry standards
- **Vendor independence** through OpenTelemetry abstraction
- **Rich operational insights** with automatic instrumentation
- **Standards compliance** for enterprise requirements
- **Ecosystem compatibility** with OpenTelemetry tooling

## 🔍 Key Monitoring Queries

### Application Insights (Kusto/KQL)

#### Request Success Rate by Service:
```kusto
requests
| where timestamp > ago(1h)
| summarize 
    Total = count(),
    Success = countif(success == true),
    SuccessRate = round(100.0 * countif(success == true) / count(), 2)
  by cloud_RoleName
| order by SuccessRate asc
```

#### OpenTelemetry Trace Analysis:
```kusto
traces
| where timestamp > ago(1h)
| where customDimensions.["trace_id"] != ""
| summarize 
    LogCount = count(),
    Services = dcount(customDimensions.["service.name"]),
    UniqueTraces = dcount(customDimensions.["trace_id"])
| project LogCount, Services, UniqueTraces, 
  TracesPerService = round(1.0 * UniqueTraces / Services, 2)
```

#### Error Rate with Trace Context:
```kusto
exceptions
| where timestamp > ago(24h)
| join kind=leftouter (
    traces 
    | where timestamp > ago(24h)
    | where customDimensions.["trace_id"] != ""
) on $left.operation_Id == $right.customDimensions.["trace_id"]
| summarize ErrorCount = count() by cloud_RoleName, bin(timestamp, 1h)
| render timechart
```

#### Performance by Endpoint with Spans:
```kusto
requests
| where timestamp > ago(1h)
| extend SpanId = tostring(customDimensions.["span_id"])
| extend TraceId = tostring(customDimensions.["trace_id"])
| summarize 
    AvgDuration = avg(duration),
    P95Duration = percentile(duration, 95),
    RequestCount = count(),
    UniqueTraces = dcount(TraceId)
  by name
| order by P95Duration desc
```

### Log Analytics (Container Logs)

#### OpenTelemetry Logs with Trace Context:
```kusto
ContainerAppConsoleLogs_CL
| where Log_s contains "trace_id"
| extend LogData = parse_json(Log_s)
| where LogData.level in ("ERROR", "WARN")
| project 
    TimeGenerated, 
    ContainerName_s, 
    Level = LogData.level,
    Message = LogData.message,
    TraceId = LogData.trace_id,
    SpanId = LogData.span_id,
    ServiceName = LogData["service.name"]
| order by TimeGenerated desc
```

#### Service Health by Trace Analysis:
```kusto
ContainerAppConsoleLogs_CL
| where Log_s contains "Service starting" or Log_s contains "Service shutting down"
| extend LogData = parse_json(Log_s)
| project 
    TimeGenerated,
    ContainerName_s,
    Event = case(LogData.message contains "starting", "START", "STOP"),
    ServiceName = LogData["service.name"],
    Port = LogData["service.startup.port"]
| summarize 
    Starts = countif(Event == "START"),
    Stops = countif(Event == "STOP")
  by ContainerName_s, ServiceName
```

## 📋 Implementation Timeline

### ✅ COMPLETED (Current State):
1. **OpenTelemetry-conformant logger** implemented as standard
2. **Azure Application Insights integration** with OTLP exporters
3. **W3C Trace Context propagation** enabled
4. **Backward compatibility** maintained for existing code
5. **Deployment infrastructure** updated with observability stack

### Immediate (Week 1):
1. **Update all JavaScript services** to use the OpenTelemetry logger
2. **Replace morgan and custom logging** with standardized middleware
3. **Test OpenTelemetry telemetry** in development environment
4. **Validate trace propagation** across service boundaries

### Short Term (Week 2-3):
1. **Deploy to staging** with OpenTelemetry logging enabled
2. **Monitor telemetry quality** and adjust sampling rates
3. **Create OpenTelemetry dashboards** in Azure portal
4. **Document service-specific implementation** patterns

### Medium Term (Month 1):
1. **Custom metrics implementation** for business KPIs
2. **Advanced trace analysis** and performance optimization
3. **Alerting refinement** based on OpenTelemetry data
4. **Integration testing** with external OpenTelemetry tools

## 🚨 Alert Conditions

### Service Health Alert
- **Condition**: No active container replicas
- **Threshold**: < 1 replica for 5 minutes
- **Severity**: Critical
- **Action**: Email notification + Auto-restart attempt

### Error Rate Alert
- **Condition**: High 5xx error rate (tracked via OpenTelemetry spans)
- **Threshold**: > 10 errors in 5 minutes
- **Severity**: High
- **Action**: Email notification + Trace analysis

### Response Time Alert
- **Condition**: Slow response times (from OpenTelemetry request spans)
- **Threshold**: > 5 seconds average for 5 minutes
- **Severity**: Medium
- **Action**: Email notification + Performance review

### OpenTelemetry-Specific Alerts:
- **Trace sampling failures** (telemetry export errors)
- **Missing span context** (broken trace propagation)
- **High error span rates** (exceptions in traces)
- **Telemetry export latency** (observability pipeline health)

## 🔒 Security Considerations

### Data Privacy:
- **OpenTelemetry semantic conventions** for consistent data classification
- **Automatic sensitive data sanitization** (API keys, tokens, cookies)
- **Trace context security** with proper propagation boundaries
- **Compliance-ready telemetry** with data retention controls

### Standards Compliance:
- **W3C Trace Context** for secure trace propagation
- **OpenTelemetry security model** for telemetry pipeline protection
- **Azure Application Insights** security and compliance features
- **RBAC for observability data** with proper access controls

## 💰 Cost Considerations

### OpenTelemetry Benefits:
- **Vendor independence** reducing lock-in costs
- **Efficient telemetry** with sampling and batching
- **Standardized exporters** reducing integration costs
- **Future flexibility** with OTLP protocol support

### Azure Application Insights:
- **OTLP ingestion** at standard Application Insights rates
- **Enhanced telemetry richness** for better value
- **Estimated monthly cost**: $70-150 for typical workload
- **ROI through standards adoption**: Significantly higher through reduced vendor lock-in and enhanced observability

---

This observability strategy provides **industry-standard, OpenTelemetry-conformant monitoring** for the xRegistry application, ensuring compliance with modern observability standards while maintaining full Azure Application Insights integration and operational excellence. 