/**
 * Dynamic proxy routes setup
 * Sets up proxy middleware for each available group type
 */

import { Express } from 'express';
import { ModelService } from '../services/model-service';
import { ProxyService } from '../services/proxy-service';

/**
 * Setup dynamic proxy routes for all available group types
 */
export function setupDynamicProxyRoutes(
    app: Express,
    modelService: ModelService,
    proxyService: ProxyService,
    logger: any
): void {
    try {
        const groupTypeToBackend = modelService.getGroupTypeToBackend();
        const groups = Object.keys(groupTypeToBackend);

        logger.info('Setting up dynamic routes for groups', { groups });

        // Add dynamic routes for each group type
        for (const [groupType, backend] of Object.entries(groupTypeToBackend)) {
            try {
                const basePath = `/${groupType}`;

                logger.info('Setting up route', { basePath, targetUrl: backend.url });

                // Get proxy middleware from ProxyService
                const middlewares = proxyService.createProxyMiddleware(groupType, backend);

                // Mount the middlewares
                app.use(basePath, ...middlewares);

            } catch (error) {
                logger.error('Error setting up route for group', {
                    groupType,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    } catch (error) {
        logger.error('Critical error in setupDynamicProxyRoutes', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    }
}
