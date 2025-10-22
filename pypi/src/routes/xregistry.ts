/**
 * xRegistry root and group routes
 * Implements /,  /model, /pythonregistries endpoints
 */

import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry-service';
import { REGISTRY_METADATA } from '../config/constants';

export function createXRegistryRoutes(registryService: RegistryService): Router {
  const router = Router();
  const { GROUP_TYPE, GROUP_ID } = REGISTRY_METADATA;

  // Helper to get base URL
  const getBaseUrl = (req: Request): string => {
    const baseUrl = process.env.XREGISTRY_PYPI_BASEURL;
    return baseUrl || `${req.protocol}://${req.get('host')}`;
  };

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
