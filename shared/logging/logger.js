/**
 * Simple xRegistry Logging Library
 * 
 * Provides basic structured logging for xRegistry services without OpenTelemetry dependencies
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class XRegistryLogger {
  constructor(options = {}) {
    this.serviceName = options.serviceName || process.env.SERVICE_NAME || 'xregistry-service';
    this.serviceVersion = options.serviceVersion || process.env.SERVICE_VERSION || '1.0.0';
    this.environment = options.environment || process.env.NODE_ENV || 'production';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile || false;
    this.logFile = options.logFile;
    
    // Context for child loggers
    this.context = options.context || {};
    
    // File stream for file logging
    this.fileStream = null;
    
    // Initialize file logging if requested
    if (this.enableFile && this.logFile) {
      this.initializeFileLogging();
    }

    this.info('Logger initialized', {
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      environment: this.environment
    });
  }

  /**
   * Initialize file logging
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
   * Express middleware for request logging
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Store request ID for correlation
      req.requestId = this.generateRequestId();
      req.logger = this.child({ requestId: req.requestId });

      // Log request start
      req.logger.info('Request started', {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent') || '',
        ip: req.ip || req.connection.remoteAddress
      });

      // Override res.end to log completion
      const originalEnd = res.end;
      res.end = function(...args) {
        const duration = Date.now() - startTime;
        req.logger.info('Request completed', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration: duration
        });
        originalEnd.apply(res, args);
      };

      next();
    };
  }

  /**
   * Backward compatibility method
   */
  setRequestContext(req, res, next) {
    return this.middleware()(req, res, next);
  }

  /**
   * Core logging method
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
      ...this.context,
      ...attributes
    };

    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    // Console output
    if (this.enableConsole) {
      const coloredOutput = this.prettyPrint(severity, message, logEntry);
      console.log(coloredOutput);
    }

    // File output
    if (this.fileStream) {
      this.fileStream.write(JSON.stringify(logEntry) + '\n');
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
      logFile: this.logFile,
      context: { ...this.context, ...additionalContext }
    });
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
    
    return `${color}[${timestamp}] ${level.toUpperCase()} ${service}${contextStr}: ${message}${reset}`;
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
   * Generate unique request ID
   */
  generateRequestId() {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * Close file streams
   */
  async close() {
    if (this.fileStream) {
      return new Promise((resolve) => {
        this.fileStream.end(() => resolve());
      });
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