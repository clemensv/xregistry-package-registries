/**
 * Proxy service
 * Handles routing requests to appropriate downstream servers
 */

import { RequestHandler } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { BASE_URL_HEADER, getBaseUrl, getApiBaseUrl } from '../config/constants';
import { DownstreamConfig } from '../types/bridge';

export class ProxyService {
    constructor(private readonly logger: any) { }

    /**
     * Recursively rewrite URLs in response data
     * Replaces downstream server URLs with bridge base URL
     * Note: Skips "xid" fields as they are canonical identifiers
     */
    private rewriteUrls(data: any, downstreamUrl: string, bridgeBaseUrl: string, currentKey?: string): any {
        if (typeof data === 'string') {
            // Skip rewriting "xid" fields - they are canonical identifiers
            if (currentKey === 'xid') {
                return data;
            }
            // Replace URLs in strings (handles "self", "shortself", and any URL fields)
            if (data.startsWith(downstreamUrl)) {
                return data.replace(downstreamUrl, bridgeBaseUrl);
            }
            return data;
        }

        if (Array.isArray(data)) {
            // Recursively process arrays
            return data.map(item => this.rewriteUrls(item, downstreamUrl, bridgeBaseUrl));
        }

        if (data && typeof data === 'object') {
            // Recursively process objects
            const rewritten: any = {};
            for (const [key, value] of Object.entries(data)) {
                rewritten[key] = this.rewriteUrls(value, downstreamUrl, bridgeBaseUrl, key);
            }
            return rewritten;
        }

        return data;
    }

    /**
     * Create proxy middleware for a specific group type
     */
    createProxyMiddleware(
        groupType: string,
        backend: DownstreamConfig
    ): RequestHandler[] {
        const targetUrl = backend.url;

        this.logger.info('Creating proxy middleware', { groupType, targetUrl });

        // Middleware to inject base URL header
        const headerMiddleware: RequestHandler = (req, res, next) => {
            try {
                // Get the actual API base URL (including API_PATH_PREFIX) from the incoming request
                const actualBaseUrl = getApiBaseUrl(req);
                req.headers[BASE_URL_HEADER] = actualBaseUrl;
                this.logger.info('Setting x-base-url header for proxy', {
                    groupType,
                    actualBaseUrl,
                    originalUrl: req.originalUrl,
                    forwardedHost: req.get('x-forwarded-host'),
                    host: req.get('host')
                });
                next();
            } catch (error) {
                this.logger.error('Error in route header middleware', {
                    error: error instanceof Error ? error.message : String(error),
                    groupType
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        };

        // Create proxy middleware with options
        const proxyOptions: Options = {
            target: targetUrl,
            changeOrigin: true,
            selfHandleResponse: true,
            
            // Rewrite path to ensure it goes to the correct backend endpoint
            // The path may include the API prefix (e.g., /registry), which we need to remove
            pathRewrite: (path, req) => {
                // Remove any API prefix if present, then ensure group type is at the start
                let cleanPath = path;
                
                // Remove /registry prefix if present
                const apiPrefix = process.env.API_PATH_PREFIX || '';
                if (apiPrefix && cleanPath.startsWith(apiPrefix)) {
                    cleanPath = cleanPath.substring(apiPrefix.length) || '/';
                }
                
                // Ensure the path starts with the group type
                if (!cleanPath.startsWith(`/${groupType}`)) {
                    cleanPath = `/${groupType}${cleanPath}`;
                }
                
                return cleanPath;
            },

            // Intercept and rewrite response body
            onProxyRes: (proxyRes, req, res) => {
                // Get the actual base URL from the request that was set by headerMiddleware
                const actualBaseUrl = req.headers[BASE_URL_HEADER] as string;

                // Add CORS headers
                if (!proxyRes.headers['access-control-allow-origin']) {
                    proxyRes.headers['access-control-allow-origin'] = '*';
                }
                if (!proxyRes.headers['access-control-allow-methods']) {
                    proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
                }
                if (!proxyRes.headers['access-control-allow-headers']) {
                    proxyRes.headers['access-control-allow-headers'] =
                        'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-MS-Client-Principal, X-Base-Url, X-Correlation-Id, X-Trace-Id';
                }

                // Only rewrite JSON responses
                const contentType = proxyRes.headers['content-type'] || '';
                if (!contentType.includes('application/json')) {
                    // Pass through non-JSON responses
                    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                    proxyRes.pipe(res);
                    return;
                }

                // Collect response body
                let body = '';
                proxyRes.on('data', (chunk) => {
                    body += chunk.toString('utf8');
                });

                proxyRes.on('end', () => {
                    try {
                        // Parse JSON and rewrite URLs using the actual base URL from the request
                        const data = JSON.parse(body);
                        const rewrittenData = this.rewriteUrls(data, targetUrl, actualBaseUrl);

                        // Send rewritten response
                        const rewrittenBody = JSON.stringify(rewrittenData);
                        res.writeHead(proxyRes.statusCode || 200, {
                            ...proxyRes.headers,
                            'content-length': Buffer.byteLength(rewrittenBody).toString()
                        });
                        res.end(rewrittenBody);
                    } catch (error) {
                        this.logger.error('Error rewriting response URLs', {
                            error: error instanceof Error ? error.message : String(error),
                            groupType,
                            targetUrl
                        });
                        // If rewriting fails, send original response
                        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                        res.end(body);
                    }
                });

                proxyRes.on('error', (error) => {
                    this.logger.error('Error reading proxy response', {
                        error: error.message,
                        groupType,
                        targetUrl
                    });
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error reading upstream response' });
                    }
                });
            },

            // Inject API key and tracing headers
            onProxyReq: (proxyReq, req: any) => {
                try {
                    // Forward x-base-url header to downstream service
                    const baseUrlValue = req.headers[BASE_URL_HEADER];
                    console.log(`[BRIDGE] onProxyReq - BASE_URL_HEADER=${BASE_URL_HEADER}, value=${baseUrlValue}, groupType=${groupType}, targetUrl=${targetUrl}`);
                    if (baseUrlValue) {
                        proxyReq.setHeader(BASE_URL_HEADER, baseUrlValue);
                        console.log(`[BRIDGE] Set ${BASE_URL_HEADER} header on proxyReq to: ${baseUrlValue}`);
                        this.logger.info('Forwarding x-base-url header to downstream service', {
                            groupType,
                            baseUrlValue,
                            targetUrl
                        });
                    } else {
                        console.log(`[BRIDGE] WARNING: No ${BASE_URL_HEADER} value in req.headers!`);
                    }
                    
                    if (backend.apiKey) {
                        proxyReq.setHeader('Authorization', `Bearer ${backend.apiKey}`);
                    }

                    // Inject distributed tracing headers
                    if (req.logger && req.logger.createDownstreamHeaders) {
                        const traceHeaders = req.logger.createDownstreamHeaders(req);
                        Object.entries(traceHeaders).forEach(([key, value]) => {
                            proxyReq.setHeader(key, String(value));
                        });

                        this.logger.debug('Injected trace headers into proxy request', {
                            groupType,
                            targetUrl,
                            traceId: req.traceId,
                            correlationId: req.correlationId,
                            requestId: req.requestId,
                            injectedHeaders: Object.keys(traceHeaders)
                        });
                    }
                } catch (error) {
                    this.logger.error('Error in proxy request handler', {
                        error: error instanceof Error ? error.message : String(error),
                        groupType,
                        targetUrl
                    });
                }
            },

            // Handle proxy errors
            onError: (err, req: any, res) => {
                this.logger.error('Proxy error', {
                    groupType,
                    targetUrl,
                    error: err instanceof Error ? err.message : String(err),
                    traceId: req.traceId,
                    correlationId: req.correlationId,
                    requestId: req.requestId
                });

                if (!res.headersSent) {
                    res.status(502).json({
                        error: 'Bad Gateway',
                        message: `Upstream server ${targetUrl} is not available`,
                        groupType,
                        traceId: req.traceId,
                        correlationId: req.correlationId
                    });
                }
            }
        };

        const proxy = createProxyMiddleware(proxyOptions);

        return [headerMiddleware, proxy];
    }
}
