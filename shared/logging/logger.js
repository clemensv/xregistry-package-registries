/**
 * OpenTelemetry-Conformant xRegistry Logging Library
 * 
 * Provides OpenTelemetry-compliant structured logging with:
 * - W3C Trace Context propagation
 * - OpenTelemetry semantic conventions
 * - Proper span context correlation
 * - OTLP exporters for Azure Application Insights
 * - Resource detection and attributes
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { ResourceAttributes, ResourceDetector } = require('@opentelemetry/resources');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { trace, context, propagation, SpanStatusCode } = require('@opentelemetry/api');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { AzureMonitorLogExporter } = require('@azure/monitor-opentelemetry-exporter');
const { AzureMonitorTraceExporter } = require('@azure/monitor-opentelemetry-exporter');
const { AzureMonitorMetricExporter } = require('@azure/monitor-opentelemetry-exporter');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');

// OpenTelemetry semantic conventions
const {
  SEMATTRS_SERVICE_NAME,
  SEMATTRS_SERVICE_VERSION,
  SEMATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMATTRS_HTTP_METHOD,
  SEMATTRS_HTTP_URL,
  SEMATTRS_HTTP_STATUS_CODE,
  SEMATTRS_HTTP_USER_AGENT,
  SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH,
  SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH,
  SEMATTRS_NET_PEER_IP,
  SEMATTRS_ERROR_TYPE,
  SEMATTRS_EXCEPTION_MESSAGE,
  SEMATTRS_EXCEPTION_STACKTRACE
} = require('@opentelemetry/semantic-conventions');

class XRegistryLogger {
  constructor(options = {}) {
    this.serviceName = options.serviceName || process.env.SERVICE_NAME || 'xregistry-service';
    this.serviceVersion = options.serviceVersion || process.env.SERVICE_VERSION || '1.0.0';
    this.environment = options.environment || process.env.NODE_ENV || 'production';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile || false;
    this.logFile = options.logFile;
    
    // OpenTelemetry providers
    this.loggerProvider = null;
    this.logger = null;
    this.tracer = null;
    this.meter = null;
    
    // Metrics
    this.requestCounter = null;
    this.requestDuration = null;
    this.errorCounter = null;
    
    // File stream for legacy file logging support
    this.fileStream = null;
    
    this.initializeOpenTelemetry();
    
    // Initialize file logging if requested (for backward compatibility)
    if (this.enableFile && this.logFile) {
      this.initializeFileLogging();
    }
  }

  /**
   * Initialize OpenTelemetry SDK with Azure exporters
   */
  initializeOpenTelemetry() {
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    
    // Create resource with semantic attributes
    const resource = new Resource({
      [SEMATTRS_SERVICE_NAME]: this.serviceName,
      [SEMATTRS_SERVICE_VERSION]: this.serviceVersion,
      [SEMATTRS_DEPLOYMENT_ENVIRONMENT]: this.environment,
      'service.instance.id': process.env.HOSTNAME || require('os').hostname(),
      'cloud.provider': 'azure',
      'cloud.platform': 'azure_container_apps'
    });

    // Configure SDK
    const sdk = new NodeSDK({
      resource,
      instrumentations: [getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-console': {
          enabled: false // We handle logging ourselves
        }
      })],
      textMapPropagator: new W3CTraceContextPropagator()
    });

    // Add Azure exporters if connection string is available
    if (connectionString) {
      // Trace exporter
      const traceExporter = new AzureMonitorTraceExporter({
        connectionString
      });
      sdk.addSpanProcessor(new BatchSpanProcessor(traceExporter));

      // Log exporter
      const logExporter = new AzureMonitorLogExporter({
        connectionString
      });
      sdk.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));

      // Metric exporter
      const metricExporter = new AzureMonitorMetricExporter({
        connectionString
      });
      sdk.addMetricReader(new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30000
      }));
    }

    // Start SDK
    sdk.start();

    // Get providers
    this.logger = logs.getLogger(this.serviceName, this.serviceVersion);
    this.tracer = trace.getTracer(this.serviceName, this.serviceVersion);
    this.meter = require('@opentelemetry/api').metrics.getMeter(this.serviceName, this.serviceVersion);

    // Create metrics
    this.requestCounter = this.meter.createCounter('http_requests_total', {
      description: 'Total number of HTTP requests'
    });

    this.requestDuration = this.meter.createHistogram('http_request_duration_ms', {
      description: 'HTTP request duration in milliseconds'
    });

    this.errorCounter = this.meter.createCounter('errors_total', {
      description: 'Total number of errors'
    });

    this.info('OpenTelemetry initialized', {
      [SEMATTRS_SERVICE_NAME]: this.serviceName,
      [SEMATTRS_SERVICE_VERSION]: this.serviceVersion,
      [SEMATTRS_DEPLOYMENT_ENVIRONMENT]: this.environment,
      'otel.sdk.enabled': true,
      'azure.connection_string.configured': !!connectionString
    });
  }

  /**
   * Initialize file logging for backward compatibility
   */
  initializeFileLogging() {
    try {
      const fs = require('fs');
      const path = require('path');
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      this.fileStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      this.info('File logging initialized', { logFile: this.logFile });
    } catch (error) {
      this.warn('Failed to initialize file logging', { 
        error: error.message,
        logFile: this.logFile 
      });
    }
  }

  /**
   * Express middleware for OpenTelemetry request tracing and logging
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Create span for this request
      const span = this.tracer.startSpan(`${req.method} ${req.route?.path || req.url}`, {
        kind: 1, // SERVER
        attributes: {
          [SEMATTRS_HTTP_METHOD]: req.method,
          [SEMATTRS_HTTP_URL]: req.url,
          [SEMATTRS_HTTP_USER_AGENT]: req.get('User-Agent') || '',
          [SEMATTRS_NET_PEER_IP]: req.ip || req.connection.remoteAddress,
          'http.request.header.content-length': req.get('content-length') || 0
        }
      });

      // Set span in context
      const spanContext = trace.setSpan(context.active(), span);
      
      // Store context in request for backward compatibility
      req.otelContext = spanContext;
      req.span = span;
      req.logContext = {
        correlationId: span.spanContext().traceId,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        startTime,
        requestId: span.spanContext().spanId
      };

      // Log request start
      context.with(spanContext, () => {
        this.info('HTTP request received', {
          [SEMATTRS_HTTP_METHOD]: req.method,
          [SEMATTRS_HTTP_URL]: req.url,
          [SEMATTRS_HTTP_USER_AGENT]: req.get('User-Agent') || '',
          [SEMATTRS_NET_PEER_IP]: req.ip || req.connection.remoteAddress,
          'http.request.headers': this.sanitizeHeaders(req.headers)
        });
      });

      // Hook into response
      const originalEnd = res.end;
      res.end = (chunk, encoding) => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;

        // Update span
        span.setAttributes({
          [SEMATTRS_HTTP_STATUS_CODE]: statusCode,
          [SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH]: res.get('content-length') || chunk?.length || 0
        });

        // Set span status
        if (statusCode >= 400) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        // Record metrics
        this.requestCounter.add(1, {
          [SEMATTRS_HTTP_METHOD]: req.method,
          [SEMATTRS_HTTP_STATUS_CODE]: statusCode.toString(),
          [SEMATTRS_SERVICE_NAME]: this.serviceName
        });

        this.requestDuration.record(duration, {
          [SEMATTRS_HTTP_METHOD]: req.method,
          [SEMATTRS_HTTP_STATUS_CODE]: statusCode.toString(),
          [SEMATTRS_SERVICE_NAME]: this.serviceName
        });

        // Log request completion
        context.with(spanContext, () => {
          this.info('HTTP request completed', {
            [SEMATTRS_HTTP_METHOD]: req.method,
            [SEMATTRS_HTTP_URL]: req.url,
            [SEMATTRS_HTTP_STATUS_CODE]: statusCode,
            'http.request.duration_ms': duration,
            'http.response.success': statusCode < 400
          });
        });

        // End span
        span.end();

        return originalEnd.call(res, chunk, encoding);
      };

      next();
    };
  }

  /**
   * Set request context for correlation (backward compatibility)
   */
  setRequestContext(req, res, next) {
    return this.middleware()(req, res, next);
  }

  /**
   * Log with OpenTelemetry semantic conventions
   */
  log(severity, message, attributes = {}, error = null) {
    const timestamp = Date.now();
    const activeSpan = trace.getActiveSpan();
    
    // Handle legacy API where attributes might be the req object
    if (attributes && attributes.method && attributes.url) {
      // This looks like a legacy req object, extract useful attributes
      const legacyReq = attributes;
      attributes = {
        [SEMATTRS_HTTP_METHOD]: legacyReq.method,
        [SEMATTRS_HTTP_URL]: legacyReq.url,
        correlationId: legacyReq.logContext?.correlationId
      };
    }
    
    // Prepare log record attributes
    const logAttributes = {
      [SEMATTRS_SERVICE_NAME]: this.serviceName,
      [SEMATTRS_SERVICE_VERSION]: this.serviceVersion,
      [SEMATTRS_DEPLOYMENT_ENVIRONMENT]: this.environment,
      ...this.childContext,
      ...attributes
    };

    // Add error attributes if present
    if (error) {
      logAttributes[SEMATTRS_ERROR_TYPE] = error.constructor.name;
      logAttributes[SEMATTRS_EXCEPTION_MESSAGE] = error.message;
      if (error.stack) {
        logAttributes[SEMATTRS_EXCEPTION_STACKTRACE] = error.stack;
      }
    }

    // Add trace context if available
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      logAttributes['trace_id'] = spanContext.traceId;
      logAttributes['span_id'] = spanContext.spanId;
      logAttributes['trace_flags'] = spanContext.traceFlags;
    }

    // Convert severity to OpenTelemetry severity number
    const severityNumber = this.getSeverityNumber(severity);
    const severityText = severity.toUpperCase();

    // Emit log record
    this.logger.emit({
      timestamp,
      severityNumber,
      severityText,
      body: message,
      attributes: logAttributes
    });

    // Console output for development
    if (this.enableConsole) {
      const logEntry = {
        timestamp: new Date(timestamp).toISOString(),
        level: severityText,
        service: this.serviceName,
        message,
        ...logAttributes
      };

      if (process.env.NODE_ENV === 'development') {
        this.prettyPrint(severity, message, logEntry);
      } else {
        console.log(JSON.stringify(logEntry));
      }
    }

    // File output for backward compatibility
    if (this.fileStream) {
      const logEntry = {
        timestamp: new Date(timestamp).toISOString(),
        level: severityText,
        service: this.serviceName,
        message,
        ...logAttributes
      };
      this.fileStream.write(JSON.stringify(logEntry) + '\n');
    }

    // Record error metrics
    if (severity === 'error' || severity === 'fatal') {
      this.errorCounter.add(1, {
        [SEMATTRS_SERVICE_NAME]: this.serviceName,
        'error.type': error?.constructor.name || 'unknown',
        'log.severity': severityText
      });

      // Add exception to span if available
      if (activeSpan && error) {
        activeSpan.recordException(error);
        activeSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
      }
    }
  }

  /**
   * Convert log level to OpenTelemetry severity number
   */
  getSeverityNumber(level) {
    const severityMap = {
      debug: SeverityNumber.DEBUG,
      info: SeverityNumber.INFO,
      warn: SeverityNumber.WARN,
      error: SeverityNumber.ERROR,
      fatal: SeverityNumber.FATAL
    };
    return severityMap[level] || SeverityNumber.INFO;
  }

  // Log level methods
  debug(message, data = {}, req = null) {
    this.log('debug', message, data, req);
  }

  info(message, data = {}, req = null) {
    this.log('info', message, data, req);
  }

  warn(message, data = {}, req = null) {
    this.log('warn', message, data, req);
  }

  error(message, data = {}, req = null) {
    this.log('error', message, data, req);
  }

  fatal(message, data = {}, req = null) {
    this.log('fatal', message, data, req);
  }

  /**
   * Log an HTTP request with timing (backward compatibility)
   */
  logRequest(req, res, duration) {
    const context = req.logContext || {};
    this.info('HTTP Request', {
      ...context,
      statusCode: res.statusCode,
      duration,
      success: res.statusCode < 400
    });
  }

  /**
   * Log application startup with semantic conventions
   */
  logStartup(port, additionalInfo = {}) {
    this.info('Service starting', {
      serviceName: this.serviceName, // Keep for backward compatibility
      'service.startup.port': port,
      'process.runtime.name': 'node',
      'process.runtime.version': process.version,
      'host.arch': process.arch,
      'os.type': process.platform,
      port, // Keep for backward compatibility
      nodeVersion: process.version, // Keep for backward compatibility
      platform: process.platform, // Keep for backward compatibility
      environment: this.environment, // Keep for backward compatibility
      ...additionalInfo
    });
  }

  /**
   * Log application shutdown (backward compatibility)
   */
  logShutdown(signal, additionalInfo = {}) {
    this.info('Service shutting down', {
      serviceName: this.serviceName,
      signal,
      uptime: process.uptime(),
      ...additionalInfo
    });
  }

  /**
   * Log health check status (backward compatibility)
   */
  logHealthCheck(status, checks = {}) {
    const level = status === 'healthy' ? 'info' : 'warn';
    this[level]('Health check', {
      serviceName: this.serviceName,
      status,
      checks,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log external dependency call with semantic conventions
   */
  logDependency(name, url, duration, success, error = null) {
    const attributes = {
      dependencyName: name, // Keep for backward compatibility
      'dependency.name': name,
      'dependency.url': url,
      'dependency.duration_ms': duration,
      'dependency.success': success,
      'dependency.type': 'http',
      url, // Keep for backward compatibility
      duration, // Keep for backward compatibility
      success, // Keep for backward compatibility
      serviceName: this.serviceName // Keep for backward compatibility
    };

    if (error) {
      attributes[SEMATTRS_ERROR_TYPE] = error.constructor.name;
      attributes[SEMATTRS_EXCEPTION_MESSAGE] = error.message;
      attributes.error = error.message || error; // Keep for backward compatibility
    }

    this.info('External dependency call', attributes, error);
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext = {}) {
    const childLogger = Object.create(this);
    childLogger.childContext = { ...this.childContext, ...additionalContext };
    return childLogger;
  }

  /**
   * Pretty print for development
   */
  prettyPrint(level, message, logEntry) {
    const colors = {
      debug: '\x1b[36m',
      info: '\x1b[32m', 
      warn: '\x1b[33m',
      error: '\x1b[31m',
      fatal: '\x1b[35m'
    };
    const reset = '\x1b[0m';
    const color = colors[level] || '';
    
    const traceInfo = logEntry.trace_id ? ` [${logEntry.trace_id.slice(0, 8)}]` : '';
    console.log(`${color}[${logEntry.timestamp}] ${logEntry.level} ${logEntry.service}${traceInfo}:${reset} ${message}`);
    
    // Show relevant attributes
    const relevantAttrs = { ...logEntry };
    delete relevantAttrs.timestamp;
    delete relevantAttrs.level;
    delete relevantAttrs.message;
    delete relevantAttrs.service;
    delete relevantAttrs[SEMATTRS_SERVICE_NAME];
    delete relevantAttrs[SEMATTRS_SERVICE_VERSION];
    delete relevantAttrs[SEMATTRS_DEPLOYMENT_ENVIRONMENT];
    
    if (Object.keys(relevantAttrs).length > 0) {
      console.log(color + JSON.stringify(relevantAttrs, null, 2) + reset);
    }
  }

  /**
   * Sanitize sensitive headers
   */
  sanitizeHeaders(headers) {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
    const sanitized = { ...headers };
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Graceful shutdown
   */
  async close() {
    if (this.fileStream) {
      this.fileStream.end();
    }
    
    // Flush all providers
    await require('@opentelemetry/sdk-node').getNodeSDK()?.shutdown();
  }
}

/**
 * Create OpenTelemetry-conformant logger
 */
function createLogger(options = {}) {
  return new XRegistryLogger(options);
}

/**
 * Create Express middleware for request correlation and timing
 */
function createRequestMiddleware(logger) {
  return logger.middleware();
}

// Log levels constant for backward compatibility
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4
};

module.exports = {
  XRegistryLogger,
  createLogger,
  createRequestMiddleware,
  LOG_LEVELS
}; 