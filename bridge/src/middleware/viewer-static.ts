import express from 'express';
import path from 'path';
import fs from 'fs';

export interface ViewerStaticOptions {
    enabled: boolean;
    viewerPath?: string;
    indexFallback?: boolean;
}

/**
 * Creates middleware for serving xRegistry Viewer static files.
 * 
 * @param options - Configuration options for the viewer static middleware
 * @returns Express middleware or null if disabled
 */
export function createViewerStaticMiddleware(options: ViewerStaticOptions): express.RequestHandler | null {
    if (!options.enabled) {
        return null;
    }

    // Default to viewer submodule dist path (Angular builds to dist/xregistry-viewer by default)
    const viewerPath = options.viewerPath || path.join(__dirname, '../../../viewer/dist/xregistry-viewer');
    
    if (!fs.existsSync(viewerPath)) {
        console.warn(`Viewer path ${viewerPath} does not exist. Viewer will not be served.`);
        console.warn('Build the viewer first: cd viewer && npm install && npm run build');
        return null;
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

    // Return middleware that handles /viewer/* routes
    return (req, res, next) => {
        if (req.path.startsWith('/viewer')) {
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
