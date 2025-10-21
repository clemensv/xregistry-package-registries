/**
 * Unit tests for HTTP utility functions
 */

import { Request, Response } from 'express';
import {
    acceptsJson,
    generateRequestId,
    getBooleanQueryParam,
    getClientIp,
    getNumericQueryParam,
    getQueryParam,
    isSafeMethod,
    isTrustedRequest,
    parseAcceptHeader,
    parseRangeHeader,
    sendErrorResponse,
    sendJsonResponse,
    setCorsHeaders,
    validateRequiredHeaders
} from '../../../src/utils/http-utils';

// Mock Express Request and Response
const createMockRequest = (options: {
    headers?: Record<string, string>;
    query?: Record<string, any>;
    method?: string;
    ip?: string | undefined;
} = {}): Partial<Request> => ({
    get: ((header: string) => {
        if (header === 'set-cookie') {
            const value = options.headers?.[header.toLowerCase()];
            return value ? [value] : undefined;
        }
        return options.headers?.[header.toLowerCase()];
    }) as any, // Type assertion to handle Express overloads
    query: options.query || {},
    method: options.method || 'GET',
    ip: options.ip !== undefined ? options.ip : '127.0.0.1'
});

const createMockResponse = (): {
    res: Partial<Response>;
    headers: Record<string, string>;
    statusCode: number;
    jsonData: any;
    getStatusCode: () => number;
    getJsonData: () => any;
} => {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let jsonData: any = null;

    const res: Partial<Response> = {
        set: ((field: any, value?: any) => {
            if (typeof field === 'string' && value !== undefined) {
                headers[field] = value;
            } else if (typeof field === 'object') {
                Object.assign(headers, field);
            }
            return res as Response;
        }) as any, // Type assertion to handle Express overloads
        status: (code: number) => {
            statusCode = code;
            return res as Response;
        },
        json: (data: any) => {
            jsonData = data;
            return res as Response;
        }
    };

    return {
        res,
        headers,
        statusCode,
        jsonData,
        getStatusCode: () => statusCode,
        getJsonData: () => jsonData
    };
};

describe('HTTP Utilities', () => {
    describe('parseAcceptHeader', () => {
        test('should return application/json for json accept header', () => {
            const req = createMockRequest({
                headers: { accept: 'application/json' }
            });

            const result = parseAcceptHeader(req as Request);
            expect(result).toBe('application/json');
        });

        test('should return application/json for wildcard accept header', () => {
            const req = createMockRequest({
                headers: { accept: '*/*' }
            });

            const result = parseAcceptHeader(req as Request);
            expect(result).toBe('application/json');
        });

        test('should return application/json as default when no accept header', () => {
            const req = createMockRequest();

            const result = parseAcceptHeader(req as Request);
            expect(result).toBe('application/json');
        });

        test('should return application/json for unsupported accept header', () => {
            const req = createMockRequest({
                headers: { accept: 'text/html' }
            });

            const result = parseAcceptHeader(req as Request);
            expect(result).toBe('application/json');
        });
    });

    describe('getClientIp', () => {
        test('should return x-forwarded-for IP when present', () => {
            const req = createMockRequest({
                headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
                ip: '127.0.0.1'
            });

            const result = getClientIp(req as Request);
            expect(result).toBe('192.168.1.1');
        });

        test('should return x-real-ip when x-forwarded-for not present', () => {
            const req = createMockRequest({
                headers: { 'x-real-ip': '192.168.1.2' },
                ip: '127.0.0.1'
            });

            const result = getClientIp(req as Request);
            expect(result).toBe('192.168.1.2');
        });

        test('should return req.ip when no proxy headers', () => {
            const req = createMockRequest({
                ip: '127.0.0.1'
            });

            const result = getClientIp(req as Request);
            expect(result).toBe('127.0.0.1');
        });

        test('should return "unknown" when no IP available', () => {
            const req = createMockRequest({
                ip: ''
            });

            const result = getClientIp(req as Request);
            expect(result).toBe('unknown');
        });
    });

    describe('sendJsonResponse', () => {
        test('should send JSON response with default status 200', () => {
            const { res, headers, getStatusCode, getJsonData } = createMockResponse();
            const data = { message: 'success' };

            sendJsonResponse(res as Response, data);

            expect(getStatusCode()).toBe(200);
            expect(headers['Content-Type']).toBe('application/json');
            expect(getJsonData()).toEqual(data);
        });

        test('should send JSON response with custom status code', () => {
            const { res, headers, getStatusCode, getJsonData } = createMockResponse();
            const data = { message: 'created' };

            sendJsonResponse(res as Response, data, 201);

            expect(getStatusCode()).toBe(201);
            expect(headers['Content-Type']).toBe('application/json');
            expect(getJsonData()).toEqual(data);
        });
    });

    describe('sendErrorResponse', () => {
        test('should send error response with correct format', () => {
            const { res, getStatusCode, getJsonData } = createMockResponse();

            sendErrorResponse(res as Response, 404, 'Not found');

            expect(getStatusCode()).toBe(404);
            expect(getJsonData()).toEqual({
                error: {
                    code: 404,
                    message: 'Not found'
                }
            });
        });

        test('should include details when provided', () => {
            const { res, getStatusCode, getJsonData } = createMockResponse();
            const details = { field: 'name', reason: 'required' };

            sendErrorResponse(res as Response, 400, 'Validation error', details);

            expect(getStatusCode()).toBe(400);
            expect(getJsonData()).toEqual({
                error: {
                    code: 400,
                    message: 'Validation error',
                    details
                }
            });
        });
    });

    describe('acceptsJson', () => {
        test('should return true for application/json accept header', () => {
            const req = createMockRequest({
                headers: { accept: 'application/json' }
            });

            const result = acceptsJson(req as Request);
            expect(result).toBe(true);
        });

        test('should return true for wildcard accept header', () => {
            const req = createMockRequest({
                headers: { accept: '*/*' }
            });

            const result = acceptsJson(req as Request);
            expect(result).toBe(true);
        });

        test('should return false for non-json accept header', () => {
            const req = createMockRequest({
                headers: { accept: 'text/html' }
            });

            const result = acceptsJson(req as Request);
            expect(result).toBe(false);
        });
    });

    describe('getQueryParam', () => {
        test('should return string query parameter', () => {
            const req = createMockRequest({
                query: { name: 'test' }
            });

            const result = getQueryParam(req as Request, 'name');
            expect(result).toBe('test');
        });

        test('should return first value for array query parameter', () => {
            const req = createMockRequest({
                query: { names: ['test1', 'test2'] }
            });

            const result = getQueryParam(req as Request, 'names');
            expect(result).toBe('test1');
        });

        test('should return undefined for missing parameter', () => {
            const req = createMockRequest({
                query: {}
            });

            const result = getQueryParam(req as Request, 'missing');
            expect(result).toBeUndefined();
        });
    });

    describe('getNumericQueryParam', () => {
        test('should return numeric value for valid number string', () => {
            const req = createMockRequest({
                query: { count: '42' }
            });

            const result = getNumericQueryParam(req as Request, 'count');
            expect(result).toBe(42);
        });

        test('should return default value for invalid number', () => {
            const req = createMockRequest({
                query: { count: 'invalid' }
            });

            const result = getNumericQueryParam(req as Request, 'count', 10);
            expect(result).toBe(10);
        });

        test('should return default value for missing parameter', () => {
            const req = createMockRequest({
                query: {}
            });

            const result = getNumericQueryParam(req as Request, 'count', 5);
            expect(result).toBe(5);
        });

        test('should return undefined when no default provided', () => {
            const req = createMockRequest({
                query: {}
            });

            const result = getNumericQueryParam(req as Request, 'count');
            expect(result).toBeUndefined();
        });
    });

    describe('getBooleanQueryParam', () => {
        test('should return true for "true" value', () => {
            const req = createMockRequest({
                query: { flag: 'true' }
            });

            const result = getBooleanQueryParam(req as Request, 'flag');
            expect(result).toBe(true);
        });

        test('should return true for "1" value', () => {
            const req = createMockRequest({
                query: { flag: '1' }
            });

            const result = getBooleanQueryParam(req as Request, 'flag');
            expect(result).toBe(true);
        });

        test('should return false for "false" value', () => {
            const req = createMockRequest({
                query: { flag: 'false' }
            });

            const result = getBooleanQueryParam(req as Request, 'flag');
            expect(result).toBe(false);
        });

        test('should return false for missing parameter', () => {
            const req = createMockRequest({
                query: {}
            });

            const result = getBooleanQueryParam(req as Request, 'flag');
            expect(result).toBe(false);
        });
    });

    describe('validateRequiredHeaders', () => {
        test('should return empty array when all headers present', () => {
            const req = createMockRequest({
                headers: {
                    'authorization': 'Bearer token',
                    'content-type': 'application/json'
                }
            });

            const missing = validateRequiredHeaders(req as Request, ['authorization', 'content-type']);
            expect(missing).toEqual([]);
        });

        test('should return missing headers', () => {
            const req = createMockRequest({
                headers: {
                    'authorization': 'Bearer token'
                }
            });

            const missing = validateRequiredHeaders(req as Request, ['authorization', 'content-type']);
            expect(missing).toEqual(['content-type']);
        });
    });

    describe('setCorsHeaders', () => {
        test('should set default CORS headers', () => {
            const { res, headers } = createMockResponse();

            setCorsHeaders(res as Response);

            expect(headers['Access-Control-Allow-Origin']).toBe('*');
            expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
            expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization, x-requested-with');
            expect(headers['Access-Control-Max-Age']).toBe('86400');
        });

        test('should set specific origin when provided', () => {
            const { res, headers } = createMockResponse();

            setCorsHeaders(res as Response, 'https://example.com');

            expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
        });
    });

    describe('isTrustedRequest', () => {
        test('should return true for npm user agent', () => {
            const req = createMockRequest({
                headers: { 'user-agent': 'npm/8.19.2 node/v18.12.1 linux x64 workspaces/false' }
            });

            const result = isTrustedRequest(req as Request);
            expect(result).toBe(true);
        });

        test('should return true for node user agent', () => {
            const req = createMockRequest({
                headers: { 'user-agent': 'node/v18.12.1' }
            });

            const result = isTrustedRequest(req as Request);
            expect(result).toBe(true);
        });

        test('should return false for unknown user agent', () => {
            const req = createMockRequest({
                headers: { 'user-agent': 'Mozilla/5.0 Chrome/91.0' }
            });

            const result = isTrustedRequest(req as Request);
            expect(result).toBe(false);
        });

        test('should return false for missing user agent', () => {
            const req = createMockRequest();

            const result = isTrustedRequest(req as Request);
            expect(result).toBe(false);
        });
    });

    describe('parseRangeHeader', () => {
        test('should return null when no range header', () => {
            const req = createMockRequest();

            const result = parseRangeHeader(req as Request, 1000);
            expect(result).toBeNull();
        });

        test('should parse valid range header', () => {
            const req = createMockRequest({
                headers: { range: 'bytes=200-400' }
            });

            const result = parseRangeHeader(req as Request, 1000);
            expect(result).toEqual({
                start: 200,
                end: 400,
                isValid: true
            });
        });

        test('should handle open-ended range', () => {
            const req = createMockRequest({
                headers: { range: 'bytes=200-' }
            });

            const result = parseRangeHeader(req as Request, 1000);
            expect(result).toEqual({
                start: 200,
                end: 999,
                isValid: true
            });
        });

        test('should validate range boundaries', () => {
            const req = createMockRequest({
                headers: { range: 'bytes=900-800' }
            });

            const result = parseRangeHeader(req as Request, 1000);
            expect(result?.isValid).toBe(false);
        });

        test('should handle invalid range format', () => {
            const req = createMockRequest({
                headers: { range: 'invalid-range' }
            });

            const result = parseRangeHeader(req as Request, 1000);
            expect(result?.isValid).toBe(false);
        });
    });

    describe('isSafeMethod', () => {
        test('should return true for GET method', () => {
            const req = createMockRequest({ method: 'GET' });
            const result = isSafeMethod(req as Request);
            expect(result).toBe(true);
        });

        test('should return true for HEAD method', () => {
            const req = createMockRequest({ method: 'HEAD' });
            const result = isSafeMethod(req as Request);
            expect(result).toBe(true);
        });

        test('should return true for OPTIONS method', () => {
            const req = createMockRequest({ method: 'OPTIONS' });
            const result = isSafeMethod(req as Request);
            expect(result).toBe(true);
        });

        test('should return false for POST method', () => {
            const req = createMockRequest({ method: 'POST' });
            const result = isSafeMethod(req as Request);
            expect(result).toBe(false);
        });

        test('should return false for PUT method', () => {
            const req = createMockRequest({ method: 'PUT' });
            const result = isSafeMethod(req as Request);
            expect(result).toBe(false);
        });

        test('should return false for DELETE method', () => {
            const req = createMockRequest({ method: 'DELETE' });
            const result = isSafeMethod(req as Request);
            expect(result).toBe(false);
        });
    });

    describe('generateRequestId', () => {
        test('should generate unique request IDs', () => {
            const id1 = generateRequestId();
            const id2 = generateRequestId();

            expect(id1).not.toBe(id2);
            expect(typeof id1).toBe('string');
            expect(typeof id2).toBe('string');
            expect(id1.length).toBeGreaterThan(0);
            expect(id2.length).toBeGreaterThan(0);
        });

        test('should generate alphanumeric request IDs', () => {
            const id = generateRequestId();
            expect(id).toMatch(/^[a-z0-9]+$/);
        });
    });
}); 