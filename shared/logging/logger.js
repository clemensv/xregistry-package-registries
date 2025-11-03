/**
 * Enhanced xRegistry Logging Library
 * 
 * Provides structured logging for xRegistry services with:
 * - OpenTelemetry trace logging (stderr)
 * - W3C Extended Log Format traffic logging (stdout or file)
 * - Detailed parameterized information
 * - Diagnostic capabilities
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const crypto = require('crypto');

class XRegistryLogger {
  constructor(options = {}) {
    this.serviceName = options.serviceName || process.env.SERVICE_NAME || 'xregistry-service';
    this.serviceVersion = options.serviceVersion || process.env.SERVICE_VERSION || '1.0.0';
    this.environment = options.environment || process.env.NODE_ENV || 'production';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile || false;
    this.logFile = options.logFile;
    
    // W3C Extended Log Format configuration
    this.enableW3CLog = options.enableW3CLog || process.env.ENABLE_W3C_LOG === 'true';
    this.w3cLogFile = options.w3cLogFile || process.env.W3C_LOG_FILE;
    this.w3cLogToStdout = options.w3cLogToStdout !== false;
    
    // Context for child loggers
    this.context = options.context || {};
    
    // File streams
    this.fileStream = null;
    this.w3cFileStream = null;
    
    // W3C log fields - following W3C Extended Log Format specification
    this.w3cFields = [
      'date', 'time', 'c-ip', 'cs-username', 'cs-method', 'cs-uri-stem', 
      'cs-uri-query', 'sc-status', 'sc-bytes', 'cs-bytes', 'time-taken',
      'cs(User-Agent)', 'cs(Referer)', 'cs(Host)', 'cs(Authorization)',
      'x-request-id', 'x-service', 'x-version'
    ];
    
    // Initialize file logging if requested
    if (this.enableFile && this.logFile) {
      this.initializeFileLogging();
    }
    
    // Initialize W3C logging if requested
    if (this.enableW3CLog) {
      this.initializeW3CLogging();
    }

    this.info('Logger initialized', {
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      environment: this.environment,
      w3cLogging: this.enableW3CLog,
      w3cLogFile: this.w3cLogFile
    });
  }

  /**
   * Initialize file logging for trace logs
   */
  initializeFileLogging() {
    try {
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
   * Initialize W3C Extended Log Format logging for traffic logs
   */
  initializeW3CLogging() {
    try {
      if (this.w3cLogFile) {
        const logDir = path.dirname(this.w3cLogFile);
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        
        this.w3cFileStream = fs.createWriteStream(this.w3cLogFile, { flags: 'a' });
        
        // Write W3C header if file is new/empty
        const stats = fs.statSync(this.w3cLogFile);
        if (stats.size === 0) {
          this.writeW3CHeader();
        }
      }
      
      // Also write header to stdout if using stdout for W3C logs
      if (this.w3cLogToStdout && !this.w3cLogFile) {
        this.writeW3CHeader(true);
      }
      
      this.info('W3C logging initialized', { 
        w3cLogFile: this.w3cLogFile,
        w3cLogToStdout: this.w3cLogToStdout 
      });
    } catch (error) {
      this.warn('Failed to initialize W3C logging', { 
        error: error.message,
        w3cLogFile: this.w3cLogFile 
      });
    }
  }

  /**
   * Write W3C Extended Log Format header
   */
  writeW3CHeader(toStdout = false) {
    const header = [
      '#Version: 1.0',
      `#Date: ${new Date().toISOString().split('T')[0]}`,
      `#Software: ${this.serviceName}/${this.serviceVersion}`,
      `#Fields: ${this.w3cFields.join(' ')}`
    ].join('\n') + '\n';

    if (toStdout) {
      process.stdout.write(header);
    } else if (this.w3cFileStream) {
      this.w3cFileStream.write(header);
    }
  }

  /**
   * Enhanced Express middleware for request logging with detailed parameters and OTel context
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const startHrTime = process.hrtime();
      
      // Extract or generate trace context for distributed tracing
      const traceContext = this.extractOrGenerateTraceContext(req);
      
      // Store request ID and detailed context for correlation
      req.requestId = traceContext.requestId;
      req.traceId = traceContext.traceId;
      req.spanId = traceContext.spanId;
      req.traceFlags = traceContext.traceFlags;
      req.correlationId = traceContext.correlationId;
      req.logger = this.child({ 
        requestId: req.requestId,
        traceId: req.traceId,
        spanId: req.spanId,
        correlationId: req.correlationId
      });
      req.startTime = startTime;

      // Enhanced request logging with detailed parameters
      req.logger.info('Request started', {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        headers: this.sanitizeHeaders(req.headers),
        userAgent: req.get('User-Agent') || '',
        contentType: req.get('Content-Type') || '',
        contentLength: req.get('Content-Length') || 0,
        host: req.get('Host') || '',
        referer: req.get('Referer') || '',
        ip: req.ip || req.connection.remoteAddress || '',
        protocol: req.protocol,
        httpVersion: req.httpVersion,
        secure: req.secure
      });

      // Override res.end to log completion with detailed response info
      const originalEnd = res.end;
      res.end = (...args) => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        const hrDuration = process.hrtime(startHrTime);
        const durationMs = hrDuration[0] * 1000 + hrDuration[1] / 1000000;

        // Enhanced completion logging
        req.logger.info('Request completed', {
          method: req.method,
          url: req.url,
          path: req.path,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          duration: duration,
          durationPrecise: Math.round(durationMs * 1000) / 1000, // microsecond precision
          responseHeaders: this.sanitizeHeaders(res.getHeaders()),
          contentLength: res.get('Content-Length') || 0,
          bytesWritten: res.socket?.bytesWritten || 0,
          bytesRead: res.socket?.bytesRead || 0
        });

        // Write W3C log entry for traffic logging
        if (this.enableW3CLog) {
          this.writeW3CLogEntry(req, res, duration);
        }

        originalEnd.apply(res, args);
      };

      next();
    };
  }

  /**
   * Write W3C Extended Log Format entry
   */
  writeW3CLogEntry(req, res, duration) {
    const now = new Date();
    const parsedUrl = url.parse(req.url, true);
    
    const entry = [
      now.toISOString().split('T')[0], // date
      now.toTimeString().split(' ')[0], // time
      req.ip || req.connection.remoteAddress || '-', // c-ip
      req.user?.userId || '-', // cs-username
      req.method, // cs-method
      parsedUrl.pathname || '-', // cs-uri-stem
      parsedUrl.search || '-', // cs-uri-query
      res.statusCode, // sc-status
      res.get('Content-Length') || '-', // sc-bytes
      req.get('Content-Length') || '-', // cs-bytes
      duration, // time-taken
      `"${req.get('User-Agent') || '-'}"`, // cs(User-Agent)
      `"${req.get('Referer') || '-'}"`, // cs(Referer)
      `"${req.get('Host') || '-'}"`, // cs(Host)
      req.get('Authorization') ? '"[REDACTED]"' : '-', // cs(Authorization)
      req.requestId || '-', // x-request-id
      this.serviceName, // x-service
      this.serviceVersion // x-version
    ].join(' ') + '\n';

    // Write to stdout (traffic log) or file
    if (this.w3cLogToStdout && !this.w3cLogFile) {
      process.stdout.write(entry);
    } else if (this.w3cFileStream) {
      this.w3cFileStream.write(entry);
    }
  }

  /**
   * Sanitize headers for logging (remove sensitive information)
   */
  sanitizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') return {};
    
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  /**
   * Core logging method - enhanced with more context
   */
  log(severity, message, attributes = {}, error = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: severity.toUpperCase(),
      message,
      service: this.serviceName,
      version: this.serviceVersion,
      environment: this.environment,
      hostname: os.hostname(),
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      ...this.context,
      ...attributes
    };

    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      };
    }

    // Trace logs go to stderr (console.error) or file
    const output = JSON.stringify(logEntry) + '\n';
    
    if (this.enableConsole) {
      // Send trace logs to stderr
      process.stderr.write(this.prettyPrint(severity, message, logEntry) + '\n');
    }

    // File output for trace logs
    if (this.fileStream) {
      this.fileStream.write(output);
    }

    return logEntry;
  }

  debug(message, data = {}, req = null) {
    return this.log('debug', message, this.enrichWithRequestData(data, req));
  }

  info(message, data = {}, req = null) {
    return this.log('info', message, this.enrichWithRequestData(data, req));
  }

  warn(message, data = {}, req = null) {
    return this.log('warn', message, this.enrichWithRequestData(data, req));
  }

  error(message, data = {}, req = null) {
    const error = data instanceof Error ? data : data.error;
    const attributes = data instanceof Error ? {} : data;
    return this.log('error', message, this.enrichWithRequestData(attributes, req), error);
  }

  fatal(message, data = {}, req = null) {
    const error = data instanceof Error ? data : data.error;
    const attributes = data instanceof Error ? {} : data;
    return this.log('fatal', message, this.enrichWithRequestData(attributes, req), error);
  }

  /**
   * Log request completion
   */
  logRequest(req, res, duration) {
    return this.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('content-length')
    }, req);
  }

  /**
   * Log service startup
   */
  logStartup(port, additionalInfo = {}) {
    return this.info('Service started', {
      port,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      ...additionalInfo
    });
  }

  /**
   * Log service shutdown
   */
  logShutdown(signal, additionalInfo = {}) {
    return this.info('Service shutting down', {
      signal,
      uptime: process.uptime(),
      ...additionalInfo
    });
  }

  /**
   * Log health check results
   */
  logHealthCheck(status, checks = {}) {
    const level = status === 'healthy' ? 'info' : 'warn';
    return this.log(level, 'Health check', {
      status,
      checks
    });
  }

  /**
   * Log dependency calls
   */
  logDependency(name, url, duration, success, error = null) {
    const level = success ? 'info' : 'error';
    const attributes = {
      dependency: name,
      url,
      duration,
      success
    };

    return this.log(level, 'Dependency call', attributes, error);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext = {}) {
    return new XRegistryLogger({
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      environment: this.environment,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      enableW3CLog: this.enableW3CLog,
      w3cLogFile: this.w3cLogFile,
      w3cLogToStdout: this.w3cLogToStdout,
      logFile: this.logFile,
      context: { ...this.context, ...additionalContext }
    });
  }

  /**
   * Backward compatibility method
   */
  setRequestContext(req, res, next) {
    return this.middleware()(req, res, next);
  }

  /**
   * Pretty print for console output
   */
  prettyPrint(level, message, logEntry) {
    const colors = {
      debug: '\x1b[36m',   // cyan
      info: '\x1b[32m',    // green
      warn: '\x1b[33m',    // yellow
      error: '\x1b[31m',   // red
      fatal: '\x1b[35m'    // magenta
    };
    const reset = '\x1b[0m';
    const color = colors[level.toLowerCase()] || '';
    
    const timestamp = logEntry.timestamp;
    const service = logEntry.service;
    const contextStr = logEntry.requestId ? ` [${logEntry.requestId}]` : '';
    
    // Extract important fields from logEntry to display
    const importantFields = [
      'serverUrl', 'url', 'duration', 'error', 'statusCode', 
      'traceId', 'correlationId', 'groups', 'activeServers', 
      'totalServers', 'count', 'consecutiveFailures'
    ];
    
    const details = {};
    for (const field of importantFields) {
      if (logEntry[field] !== undefined && logEntry[field] !== null) {
        details[field] = logEntry[field];
      }
    }
    
    const detailsStr = Object.keys(details).length > 0 
      ? ' ' + JSON.stringify(details) 
      : '';
    
    return `${color}[${timestamp}] ${level.toUpperCase()} ${service}${contextStr}: ${message}${detailsStr}${reset}`;
  }

  /**
   * Enrich log data with request information
   */
  enrichWithRequestData(data, req) {
    if (!req) return data;
    
    return {
      ...data,
      requestId: req.requestId,
      method: req.method,
      url: req.url
    };
  }

  /**
   * Extract or generate OpenTelemetry trace context for distributed tracing
   */
  extractOrGenerateTraceContext(req) {
    let traceId, spanId, traceFlags = '01';
    let correlationId = req.headers['x-correlation-id'];
    let requestId;

    // Extract W3C trace context from traceparent header
    const traceparent = req.headers['traceparent'];
    if (traceparent && this.isValidTraceparent(traceparent)) {
      const parts = traceparent.split('-');
      traceId = parts[1];
      const parentSpanId = parts[2];
      traceFlags = parts[3];
      
      // Generate new span ID for this service
      spanId = this.generateSpanId();
      requestId = req.headers['x-request-id'] || this.generateRequestId();
      
      this.debug('Extracted trace context from upstream', {
        traceId,
        parentSpanId,
        spanId,
        traceFlags,
        requestId,
        correlationId
      });
    } else {
      // Generate new trace context
      traceId = this.generateTraceId();
      spanId = this.generateSpanId();
      requestId = req.headers['x-request-id'] || this.generateRequestId();
      correlationId = correlationId || this.generateCorrelationId();
      
      this.debug('Generated new trace context', {
        traceId,
        spanId,
        traceFlags,
        requestId,
        correlationId
      });
    }

    // Set response headers for downstream propagation
    if (req.res) {
      req.res.setHeader('x-request-id', requestId);
      req.res.setHeader('x-correlation-id', correlationId);
      req.res.setHeader('x-trace-id', traceId);
    }

    return {
      traceId,
      spanId,
      traceFlags,
      requestId,
      correlationId
    };
  }

  /**
   * Validate W3C traceparent header format
   */
  isValidTraceparent(traceparent) {
    // W3C format: 00-<trace-id>-<parent-id>-<trace-flags>
    const regex = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
    return regex.test(traceparent);
  }

  /**
   * Generate W3C trace ID (32 hex characters)
   */
  generateTraceId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate W3C span ID (16 hex characters)
   */
  generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Generate correlation ID
   */
  generateCorrelationId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * Create headers for downstream service calls with trace context
   */
  createDownstreamHeaders(req, additionalHeaders = {}) {
    const headers = {
      'x-request-id': req.requestId,
      'x-correlation-id': req.correlationId,
      'x-trace-id': req.traceId,
      ...additionalHeaders
    };

    // Add W3C traceparent header for standards compliance
    if (req.traceId && req.spanId) {
      headers['traceparent'] = `00-${req.traceId}-${req.spanId}-${req.traceFlags || '01'}`;
    }

    // Propagate tracestate if present
    if (req.headers['tracestate']) {
      headers['tracestate'] = req.headers['tracestate'];
    }

    return headers;
  }

  /**
   * Close file streams
   */
  async close() {
    const promises = [];
    
    if (this.fileStream) {
      promises.push(new Promise((resolve) => {
        this.fileStream.end(() => resolve());
      }));
    }
    
    if (this.w3cFileStream) {
      promises.push(new Promise((resolve) => {
        this.w3cFileStream.end(() => resolve());
      }));
    }
    
    if (promises.length > 0) {
      return Promise.all(promises);
    }
  }
}

/**
 * Create a logger instance
 */
function createLogger(options = {}) {
  return new XRegistryLogger(options);
}

/**
 * Create Express middleware
 */
function createRequestMiddleware(logger) {
  return logger.middleware();
}

module.exports = {
  XRegistryLogger,
  createLogger,
  createRequestMiddleware
}; 