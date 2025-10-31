/**
 * xRegistry root and group routes
 * Implements /,  /model, /pythonregistries endpoints
 */

import { Request, Response, Router } from 'express';
import { getBaseUrl, REGISTRY_METADATA } from '../config/constants';
import { RegistryService } from '../services/registry-service';

export function createXRegistryRoutes(registryService: RegistryService): Router {
    const router = Router();
    const { GROUP_TYPE, GROUP_ID } = REGISTRY_METADATA;

    // Root endpoint
    router.get('/', (req: Request, res: Response) => {
        const baseUrl = getBaseUrl(req);
        const rootResponse = registryService.getRoot(baseUrl);
        res.json(rootResponse);
    });

    // Model endpoint
    router.get('/model', (req: Request, res: Response) => {
        const baseUrl = getBaseUrl(req);
        const modelResponse = registryService.getModel(baseUrl);
        res.json(modelResponse);
    });

    // Capabilities endpoint
    router.get('/capabilities', (_req: Request, res: Response) => {
        const capabilitiesResponse = registryService.getCapabilities();
        res.json(capabilitiesResponse);
    });

    // Export endpoint
    router.get('/export', (_req: Request, res: Response) => {
        res.redirect(302, '/?doc&inline=*,capabilities,modelsource');
    });

    // Group collection
    router.get(`/${GROUP_TYPE}`, (req: Request, res: Response) => {
        const baseUrl = getBaseUrl(req);
        const groupsResponse = registryService.getGroups(baseUrl);
        res.json(groupsResponse);
    });

    // Single group
    router.get(`/${GROUP_TYPE}/${GROUP_ID}`, (req: Request, res: Response) => {
        const baseUrl = getBaseUrl(req);
        const groupResponse = registryService.getGroupDetails(baseUrl);
        res.json(groupResponse);
    });

    return router;
}
