/**
 * Unit tests for logging middleware
 */

import { Request, Response } from 'express';
import {
    ConsoleLogger,
    createLoggingMiddleware,
    logger,
    loggingMiddleware,
    LogLevel,
} from '../../../src/middleware/logging';

// Mock console methods
const originalConsole = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
};

beforeEach(() => {
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
    console.debug = jest.fn();
});

afterEach(() => {
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
});

describe('Logging Middleware', () => {
    describe('LogLevel', () => {
        test('should have correct enum values', () => {
            expect(LogLevel.ERROR).toBe('error');
            expect(LogLevel.WARN).toBe('warn');
            expect(LogLevel.INFO).toBe('info');
            expect(LogLevel.DEBUG).toBe('debug');
        });
    });

    describe('ConsoleLogger', () => {
        let consoleLogger: ConsoleLogger;

        beforeEach(() => {
            consoleLogger = new ConsoleLogger();
            delete process.env['LOG_LEVEL'];
        });

        test('should log error messages', () => {
            consoleLogger.error('Test error', { key: 'value' });

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('ERROR: Test error')
            );
        });

        test('should log warn messages', () => {
            consoleLogger.warn('Test warning', { key: 'value' });

            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('WARN: Test warning')
            );
        });

        test('should log info messages', () => {
            consoleLogger.info('Test info', { key: 'value' });

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining('INFO: Test info')
            );
        });

        test('should not log debug messages by default', () => {
            consoleLogger.debug('Test debug', { key: 'value' });

            expect(console.debug).not.toHaveBeenCalled();
        });

        test('should log debug messages when LOG_LEVEL is debug', () => {
            process.env['LOG_LEVEL'] = 'debug';
            const debugLogger = new ConsoleLogger();

            debugLogger.debug('Test debug', { key: 'value' });

            expect(console.debug).toHaveBeenCalledWith(
                expect.stringContaining('DEBUG: Test debug')
            );
        });

        test('should include metadata in log message', () => {
            const meta = { requestId: '123', userId: 'user1' };
            consoleLogger.info('Test message', meta);

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining(JSON.stringify(meta))
            );
        });

        test('should format timestamp correctly', () => {
            consoleLogger.info('Test message');

            expect(console.info).toHaveBeenCalledWith(
                expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
            );
        });

        test('should respect log level hierarchy', () => {
            process.env['LOG_LEVEL'] = 'warn';
            const warnLogger = new ConsoleLogger();

            warnLogger.error('Error message');
            warnLogger.warn('Warn message');
            warnLogger.info('Info message');
            warnLogger.debug('Debug message');

            expect(console.error).toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalled();
            expect(console.info).not.toHaveBeenCalled();
            expect(console.debug).not.toHaveBeenCalled();
        });
    });

    describe('createLoggingMiddleware', () => {
        test('should create middleware function', () => {
            const middleware = createLoggingMiddleware();
            expect(typeof middleware).toBe('function');
        });

        test('should skip logging for specified paths', () => {
            const middleware = createLoggingMiddleware({ skipPaths: ['/health'] });
            const req = { method: 'GET', path: '/health', headers: {} } as Request;
            const res = { setHeader: jest.fn(), on: jest.fn() } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.setHeader).not.toHaveBeenCalled();
        });

        test('should skip logging for specified methods', () => {
            const middleware = createLoggingMiddleware({ skipMethods: ['OPTIONS'] });
            const req = { method: 'OPTIONS', path: '/test', headers: {} } as Request;
            const res = { setHeader: jest.fn(), on: jest.fn() } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.setHeader).not.toHaveBeenCalled();
        });

        test('should set request ID header', () => {
            const middleware = createLoggingMiddleware();
            const req = {
                method: 'GET',
                path: '/test',
                headers: {},
                connection: { remoteAddress: '127.0.0.1' }
            } as unknown as Request;
            const res = {
                setHeader: jest.fn(),
                on: jest.fn(),
                statusCode: 200
            } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.stringMatching(/^req_\d+_[a-z0-9]+$/));
        });

        test('should log incoming request', () => {
            process.env['LOG_LEVEL'] = 'info';
            const middleware = createLoggingMiddleware();
            const req = {
                method: 'GET',
                path: '/test',
                headers: { 'user-agent': 'test-agent' },
                connection: { remoteAddress: '127.0.0.1' }
            } as unknown as Request;
            const res = {
                setHeader: jest.fn(),
                on: jest.fn(),
                statusCode: 200
            } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining('INFO: Incoming request')
            );
        });

        test('should handle missing user agent', () => {
            process.env['LOG_LEVEL'] = 'info';
            const middleware = createLoggingMiddleware();
            const req = {
                method: 'GET',
                path: '/test',
                headers: {},
                connection: { remoteAddress: '127.0.0.1' }
            } as unknown as Request;
            const res = {
                setHeader: jest.fn(),
                on: jest.fn(),
                statusCode: 200
            } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining('INFO: Incoming request')
            );
        });

        test('should use custom logger', () => {
            const customLogger = {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
            };
            const middleware = createLoggingMiddleware({ logger: customLogger });
            const req = {
                method: 'GET',
                path: '/test',
                headers: {},
                connection: { remoteAddress: '127.0.0.1' }
            } as unknown as Request;
            const res = {
                setHeader: jest.fn(),
                on: jest.fn(),
                statusCode: 200
            } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(customLogger.info).toHaveBeenCalledWith(
                'Incoming request',
                expect.any(Object)
            );
            expect(console.info).not.toHaveBeenCalled();
        });

        test('should extract IP from x-forwarded-for header', () => {
            process.env['LOG_LEVEL'] = 'info';
            const middleware = createLoggingMiddleware();
            const req = {
                method: 'GET',
                path: '/test',
                headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
                connection: { remoteAddress: '127.0.0.1' }
            } as unknown as Request;
            const res = {
                setHeader: jest.fn(),
                on: jest.fn(),
                statusCode: 200
            } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining('INFO: Incoming request')
            );
        });

        test('should extract IP from x-real-ip header', () => {
            process.env['LOG_LEVEL'] = 'info';
            const middleware = createLoggingMiddleware();
            const req = {
                method: 'GET',
                path: '/test',
                headers: { 'x-real-ip': '192.168.1.2' },
                connection: { remoteAddress: '127.0.0.1' }
            } as unknown as Request;
            const res = {
                setHeader: jest.fn(),
                on: jest.fn(),
                statusCode: 200
            } as unknown as Response;
            const next = jest.fn();

            middleware(req, res, next);

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining('INFO: Incoming request')
            );
        });
    });

    describe('default export', () => {
        test('should export default logger', () => {
            expect(logger).toBeInstanceOf(ConsoleLogger);
        });

        test('should export default logging middleware', () => {
            expect(typeof loggingMiddleware).toBe('function');
        });
    });
}); 