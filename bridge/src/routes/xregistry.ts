/**
 * xRegistry static route handlers
 * Handles root, model, capabilities, registries, health, and status endpoints
 */

import axios from 'axios';
import { Request, Response, Router } from 'express';
import { BASE_URL, BRIDGE_EPOCH, BRIDGE_STARTUP_TIME } from '../config/constants';
import { DownstreamService } from '../services/downstream-service';
import { HealthService } from '../services/health-service';
import { ModelService } from '../services/model-service';

export function createXRegistryRoutes(
    modelService: ModelService,
    healthService: HealthService,
    downstreamService: DownstreamService,
    logger: any
): Router {
    const router = Router();

    // Root endpoint with inline support
    router.get('/', async (req: Request, res: Response) => {
        try {
            // Handle query parameters
            const inline = req.query.inline as string;
            const specversion = (req.query.specversion as string) || '1.0';

            logger.info('Root endpoint called', {
                baseUrl: BASE_URL,
                requestHost: req.get('host'),
                requestUrl: req.url,
                requestProtocol: req.protocol,
                originalUrl: req.originalUrl
            });

            // Check if requested specversion is supported
            if (specversion !== '1.0' && specversion !== '1.0-rc1') {
                return res.status(400).json({
                    error: 'unsupported_specversion',
                    message: `Specversion '${specversion}' is not supported. Supported versions: 1.0, 1.0-rc1`
                });
            }

            const now = new Date().toISOString();
            const groups = modelService.getAvailableGroups();
            const consolidatedModel = modelService.getConsolidatedModel();
            const consolidatedCapabilities = modelService.getConsolidatedCapabilities();
            const groupTypeToBackend = modelService.getGroupTypeToBackend();
            const serverStates = downstreamService.getServerStates();

            // Build the base registry response according to xRegistry spec
            const registryResponse: any = {
                specversion: specversion,
                registryid: 'xregistry-bridge',
                self: BASE_URL,
                xid: '/',
                epoch: BRIDGE_EPOCH,
                name: 'xRegistry Bridge',
                description: 'Unified xRegistry bridge for multiple package registry backends',
                createdat: BRIDGE_STARTUP_TIME,
                modifiedat: now
            };

            // Add group collections (REQUIRED)
            for (const groupType of groups) {
                const plural = consolidatedModel.groups?.[groupType]?.plural || groupType;
                registryResponse[`${plural}url`] = `${BASE_URL}/${groupType}`;

                // Get count from the server state that holds this registry
                const backendServer = groupTypeToBackend[groupType];
                const serverState = backendServer ? serverStates.get(backendServer.url) : undefined;

                // Default to 1 for known registry types
                let defaultCount = 0;
                if (['javaregistries', 'dotnetregistries', 'noderegistries', 'pythonregistries', 'containerregistries'].includes(groupType)) {
                    defaultCount = 1;
                }

                if (serverState?.isActive && serverState.model?.groups?.[groupType]?.plural) {
                    const serverPlural = serverState.model.groups[groupType].plural;
                    const countKey = `${serverPlural}count`;
                    const serverCount = serverState.model[countKey] !== undefined ? serverState.model[countKey] : 0;
                    registryResponse[`${plural}count`] = serverCount > 0 ? serverCount : defaultCount;
                } else {
                    registryResponse[`${plural}count`] = defaultCount;
                }
            }

            // Handle inline parameters
            if (inline) {
                const inlineRequests = inline.split(',').map(s => s.trim());

                if (inlineRequests.includes('model')) {
                    registryResponse.model = consolidatedModel;
                }

                if (inlineRequests.includes('capabilities')) {
                    registryResponse.capabilities = consolidatedCapabilities;
                }

                // Handle inline group collections
                for (const groupType of groups) {
                    const plural = consolidatedModel.groups?.[groupType]?.plural || groupType;
                    if (inlineRequests.includes(plural)) {
                        const backendServer = groupTypeToBackend[groupType];

                        if (backendServer) {
                            try {
                                const headers: Record<string, string> = {};
                                if (backendServer.apiKey) {
                                    headers['Authorization'] = `Bearer ${backendServer.apiKey}`;
                                }

                                const groupResponse = await axios.get(`${backendServer.url}/${groupType}`, {
                                    headers,
                                    timeout: 5000
                                });

                                registryResponse[plural] = groupResponse.data;

                                logger.debug('Inlined group collection', {
                                    groupType,
                                    plural,
                                    backendUrl: backendServer.url
                                });
                            } catch (error) {
                                logger.error('Failed to fetch group collection for inlining', {
                                    groupType,
                                    plural,
                                    backendUrl: backendServer.url,
                                    error: error instanceof Error ? error.message : String(error)
                                });
                                registryResponse[plural] = {};
                            }
                        } else {
                            registryResponse[plural] = {};
                        }
                    }
                }
            }

            return res.json(registryResponse);
        } catch (error) {
            logger.error('Error in root endpoint', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred'
            });
        }
    });

    // Model endpoint
    router.get('/model', (_req: Request, res: Response) => {
        try {
            res.json(modelService.getConsolidatedModel());
        } catch (error) {
            logger.error('Error in model endpoint', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Capabilities endpoint
    router.get('/capabilities', (_req: Request, res: Response) => {
        try {
            res.json(modelService.getConsolidatedCapabilities());
        } catch (error) {
            logger.error('Error in capabilities endpoint', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Registries endpoint - returns the groups from consolidated model
    router.get('/registries', (_req: Request, res: Response) => {
        try {
            const consolidatedModel = modelService.getConsolidatedModel();
            res.json(consolidatedModel.groups || {});
        } catch (error) {
            logger.error('Error in registries endpoint', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Health endpoint
    router.get('/health', async (_req: Request, res: Response) => {
        try {
            const health = await healthService.getHealth();
            res.status(health.status === 'healthy' ? 200 : 503).json(health);
        } catch (error) {
            logger.error('Error in health endpoint', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Status endpoint for detailed server information
    router.get('/status', (_req: Request, res: Response) => {
        try {
            const status = healthService.getStatus();
            res.json(status);
        } catch (error) {
            logger.error('Error in status endpoint', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    return router;
}
