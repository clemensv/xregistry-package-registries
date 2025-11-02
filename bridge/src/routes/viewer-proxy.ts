import { Router, Request, Response } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { URL } from 'url';

export interface ViewerProxyOptions {
    enabled: boolean;
    maxRedirects?: number;
    timeout?: number;
    logger: any;
}

/**
 * Creates CORS proxy routes for the xRegistry Viewer.
 * Allows the viewer to access xRegistry endpoints that don't support CORS.
 * 
 * @param options - Configuration options for the proxy
 * @returns Express router or null if disabled
 */
export function createViewerProxyRoutes(options: ViewerProxyOptions): Router | null {
    if (!options.enabled) {
        return null;
    }

    const router = Router();
    const { logger, maxRedirects = 5, timeout = 30000 } = options;

    /**
     * POST /api/proxy
     * Proxies requests to xRegistry endpoints
     * 
     * Request body:
     * {
     *   url: string,           // Target xRegistry endpoint
     *   method?: string,       // HTTP method (default: GET)
     *   headers?: object,      // Additional headers
     *   params?: object,       // Query parameters
     *   data?: any            // Request body (for POST/PUT)
     * }
     */
    router.post('/api/proxy', async (req: Request, res: Response): Promise<void> => {
        try {
            const { url, method = 'GET', headers = {}, params = {}, data } = req.body;

            // Validate URL
            if (!url || typeof url !== 'string') {
                res.status(400).json({ 
                    error: 'Invalid request',
                    message: 'URL is required' 
                });
                return;
            }

            // Parse and validate target URL
            let targetUrl: URL;
            try {
                targetUrl = new URL(url);
            } catch (error) {
                res.status(400).json({ 
                    error: 'Invalid URL',
                    message: 'Provided URL is not valid' 
                });
                return;
            }

            // Security: Only allow HTTP/HTTPS protocols
            if (!['http:', 'https:'].includes(targetUrl.protocol)) {
                res.status(400).json({ 
                    error: 'Invalid protocol',
                    message: 'Only HTTP and HTTPS protocols are allowed' 
                });
                return;
            }

            logger.info('Viewer proxy request', {
                method,
                url: targetUrl.origin + targetUrl.pathname,
                hasAuth: !!headers['authorization']
            });

            // Prepare axios request config
            const axiosConfig: AxiosRequestConfig = {
                method,
                url,
                params,
                headers: {
                    ...headers,
                    // Remove host header to avoid conflicts
                    host: undefined,
                    // Forward user agent with proxy identifier
                    'user-agent': `xRegistry-Viewer-Proxy/1.0 ${headers['user-agent'] || ''}`
                },
                data,
                maxRedirects,
                timeout,
                validateStatus: () => true, // Don't throw on any status
            };

            // Make the proxied request
            const response = await axios(axiosConfig);

            // Forward response headers (excluding some)
            const excludedHeaders = ['host', 'connection', 'keep-alive', 'transfer-encoding'];
            Object.entries(response.headers).forEach(([key, value]) => {
                if (!excludedHeaders.includes(key.toLowerCase())) {
                    res.setHeader(key, value as string);
                }
            });

            // Add CORS headers for viewer
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            // Send response with same status code
            res.status(response.status).json(response.data);

        } catch (error) {
            logger.error('Viewer proxy error', {
                error: error instanceof Error ? error.message : String(error),
                url: req.body.url,
                stack: error instanceof Error ? error.stack : undefined
            });

            res.status(500).json({
                error: 'Proxy error',
                message: error instanceof Error ? error.message : 'Failed to proxy request'
            });
        }
    });

    // Handle OPTIONS for CORS preflight
    router.options('/api/proxy', (_req: Request, res: Response) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.sendStatus(204);
    });

    return router;
}
