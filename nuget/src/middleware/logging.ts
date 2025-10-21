/**
 * Logging middleware for xRegistry NPM wrapper
 * Provides structured request/response logging with performance metrics
 */

import { NextFunction, Request, Response } from 'express';

/**
 * Log levels
 */
export enum LogLevel {
    ERROR = 'error',
    WARN = 'warn',
    INFO = 'info',
    DEBUG = 'debug',
}

/**
 * Logger interface
 */
export interface Logger {
    error(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Console logger implementation
 */
export class ConsoleLogger implements Logger {
    private shouldLog(level: LogLevel): boolean {
        const currentLevel = process.env['LOG_LEVEL'] || LogLevel.INFO;
        const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
        return levels.indexOf(level) <= levels.indexOf(currentLevel as LogLevel);
    }

    private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    }

    error(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(this.formatMessage(LogLevel.ERROR, message, meta));
        }
    }

    warn(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(this.formatMessage(LogLevel.WARN, message, meta));
        }
    }

    info(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.INFO)) {
            console.info(this.formatMessage(LogLevel.INFO, message, meta));
        }
    }

    debug(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.debug(this.formatMessage(LogLevel.DEBUG, message, meta));
        }
    }
}

/**
 * Default logger instance
 */
export const logger = new ConsoleLogger();

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract client IP address
 */
function getClientIp(req: Request): string {
    return (
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        (req.headers['x-real-ip'] as string) ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        'unknown'
    );
}

/**
 * Logging middleware options
 */
export interface LoggingOptions {
    /** Custom logger instance */
    logger?: Logger;
    /** Skip logging for certain paths */
    skipPaths?: string[];
    /** Skip logging for certain methods */
    skipMethods?: string[];
}

/**
 * Create logging middleware
 */
export function createLoggingMiddleware(options: LoggingOptions = {}): (req: Request, res: Response, next: NextFunction) => void {
    const {
        logger: customLogger = logger,
        skipPaths = ['/health', '/metrics'],
        skipMethods = ['OPTIONS'],
    } = options;

    return (req: Request, res: Response, next: NextFunction): void => {
        // Skip logging for certain paths or methods
        if (skipPaths.includes(req.path) || skipMethods.includes(req.method)) {
            next();
            return;
        }

        const startTime = Date.now();
        const requestId = generateRequestId();
        const ip = getClientIp(req);

        // Add request ID to response headers for tracing
        res.setHeader('X-Request-ID', requestId);

        // Log incoming request
        customLogger.info('Incoming request', {
            requestId,
            method: req.method,
            path: req.path,
            ip,
            userAgent: req.headers['user-agent'] || 'unknown',
        });

        // Log response when finished
        res.on('finish', () => {
            const responseTime = Date.now() - startTime;

            // Log response
            const logData = {
                requestId,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                responseTime,
                ip,
            };

            if (res.statusCode >= 400) {
                customLogger.warn('Request completed with error', logData);
            } else {
                customLogger.info('Request completed', logData);
            }
        });

        next();
    };
}

/**
 * Default logging middleware
 */
export const loggingMiddleware = createLoggingMiddleware(); 