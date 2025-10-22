/**
 * Proxy service
 * Handles routing requests to appropriate downstream servers
 */

import { RequestHandler } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { DownstreamConfig } from '../types/bridge';
import { BASE_URL, BASE_URL_HEADER } from '../config/constants';

export class ProxyService {
  constructor(private readonly logger: any) {}

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
        req.headers[BASE_URL_HEADER] = BASE_URL;
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
      
      // Ensure CORS headers are preserved/added to proxied responses
      onProxyRes: (proxyRes, _req, _res) => {
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
      },
      
      // Inject API key and tracing headers
      onProxyReq: (proxyReq, req: any) => {
        try {
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
