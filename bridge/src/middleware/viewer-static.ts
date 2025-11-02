import express from 'express';
import path from 'path';
import fs from 'fs';
import { Logger } from '../../../shared/logging/logger';

export interface ViewerStaticOptions {
    enabled: boolean;
    viewerPath?: string;
    indexFallback?: boolean;
    logger?: Logger;
}

/**
 * Creates middleware for serving xRegistry Viewer static files.
 * 
 * @param options - Configuration options for the viewer static middleware
 * @returns Express middleware or null if disabled
 */
export function createViewerStaticMiddleware(options: ViewerStaticOptions): express.RequestHandler | null {
    const logger = options.logger;
    
    if (logger) {
        logger.info('[VIEWER-DEBUG] createViewerStaticMiddleware called', {
            enabled: options.enabled,
            viewerPath: options.viewerPath,
            indexFallback: options.indexFallback
        });
    }
    
    if (!options.enabled) {
        if (logger) {
            logger.info('[VIEWER-DEBUG] Viewer is DISABLED, returning null');
        }
        return null;
    }

    // Default to viewer submodule dist path (Angular builds to dist/xregistry-viewer by default)
    const viewerPath = options.viewerPath || path.join(__dirname, '../../../viewer/dist/xregistry-viewer');
    
    if (logger) {
        logger.info(`[VIEWER-DEBUG] Checking if viewer path exists`, { viewerPath });
    }
    
    if (!fs.existsSync(viewerPath)) {
        if (logger) {
            logger.warn(`[VIEWER-DEBUG] Viewer path does NOT EXIST. Viewer will not be served.`, { viewerPath });
            logger.warn('Build the viewer first: cd viewer && npm install && npm run build');
        }
        return null;
    }
    
    if (logger) {
        const contents = fs.readdirSync(viewerPath).slice(0, 5);
        logger.info(`[VIEWER-DEBUG] Viewer path EXISTS!`, { viewerPath, fileCount: fs.readdirSync(viewerPath).length, firstFiles: contents });
    }

    // Create static file middleware with proper configuration
    const staticMiddleware = express.static(viewerPath, {
        index: 'index.html',
        setHeaders: (res, filePath) => {
            // Set proper content types
            if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            } else if (filePath.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
            } else if (filePath.endsWith('.json')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            } else if (filePath.endsWith('.html')) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
            }
            
            // Cache static assets but not index.html
            if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.woff') || filePath.endsWith('.woff2')) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    });

    // Return middleware that handles /viewer/* routes (except API)
    return (req, res, next) => {
        if (req.path.startsWith('/viewer')) {
            // Skip static serving for API routes
            if (req.path.startsWith('/viewer/api/')) {
                return next();
            }
            
            // Remove /viewer prefix for static file serving
            req.url = req.url.replace(/^\/viewer/, '');
            
            // For Angular routing, serve index.html for non-file requests (SPA fallback)
            if (options.indexFallback && !path.extname(req.url)) {
                req.url = '/index.html';
            }
            
            // If URL is empty after removing prefix, serve index
            if (!req.url || req.url === '/') {
                req.url = '/index.html';
            }
            
            staticMiddleware(req, res, next);
        } else {
            next();
        }
    };
}
