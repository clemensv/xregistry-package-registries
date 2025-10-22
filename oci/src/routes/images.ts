/**
 * image routes for the OCI xRegistry wrapper
 */

import { Request, Response, Router } from 'express';
import { GROUP_CONFIG, PAGINATION, RESOURCE_CONFIG } from '../config/constants';
import { asyncHandler, throwEntityNotFound } from '../middleware/xregistry-error-handler';
import { applyFilterFlag, applyInlineFlag, applySortFlag } from '../middleware/xregistry-flags';
import { ImageService } from '../services/image-service';
import { parseFilterParams, parsePaginationParams } from '../utils/request-utils';

export interface imageRouterOptions {
    ImageService: ImageService;
    logger?: any;
}

/**
 * Create image routes
 */
export function createimageRoutes(options: imageRouterOptions): Router {
    const { ImageService } = options;
    const router = Router();

    /**
     * GET /:groupId/images
     * Get all images with filtering and pagination
     * Applies xRegistry request flags: ?inline, ?filter, ?sort
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'Group', groupId);
        }

        const filters = parseFilterParams(req.query['filter']);
        const { offset, limit } = parsePaginationParams(req.query, PAGINATION.DEFAULT_PAGE_LIMIT);

        const { images } = await ImageService.getAllImages(groupId, filters, offset, limit);

        // Apply xRegistry request flags
        const xregistryFlags = (req as any).xregistryFlags;
        let processedImages = images;

        // Apply filter flag (server-side filtering beyond basic filters)
        if (xregistryFlags?.filter) {
            processedImages = applyFilterFlag(processedImages, xregistryFlags.filter) as typeof images;
        }

        // Apply sort flag
        if (xregistryFlags?.sort) {
            processedImages = applySortFlag(processedImages, xregistryFlags.sort) as typeof images;
        }

        // Apply inline flag to each image
        if (xregistryFlags?.inline !== undefined) {
            processedImages = processedImages.map((image: any) =>
                applyInlineFlag(image, xregistryFlags.inline)
            );
        }

        const responseData: Record<string, any> = {};
        processedImages.forEach((pkg: any, index: any) => {
            const name = pkg['name'] || `image-${index}`;
            responseData[name] = pkg;
        });

        res.json(responseData);
    }));

    /**
     * GET /:groupId/images/:imageName
     * Get specific image details
     * Applies xRegistry request flags: ?inline, ?epoch
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}/:imageName`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        const imageName = req.params['imageName'] || '';

        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'Group', groupId);
        }

        const imageData = await ImageService.getImage(groupId, imageName);
        if (!imageData) {
            throwEntityNotFound(req.originalUrl, 'Image', imageName);
        }

        // Apply xRegistry request flags
        const xregistryFlags = (req as any).xregistryFlags;

        // Apply inline flag to remove unwanted collections
        let response = imageData;
        if (xregistryFlags?.inline !== undefined) {
            response = applyInlineFlag(imageData, xregistryFlags.inline);
        }

        res.json(response);
    }));

    /**
     * GET /:groupId/images/:imageName/meta
     * Get Meta entity for an image (Resource-level metadata)
     * Applies xRegistry request flags: ?inline
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}/:imageName/meta`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        const imageName = req.params['imageName'] || '';

        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'Group', groupId);
        }

        const meta = await ImageService.getImageMeta(groupId, imageName);
        if (!meta) {
            throwEntityNotFound(req.originalUrl, 'Meta', `${imageName}/meta`);
        }

        // Apply xRegistry request flags
        const xregistryFlags = (req as any).xregistryFlags;

        // Apply inline flag (Meta has no collections by default, but for future-proofing)
        let response = meta;
        if (xregistryFlags?.inline !== undefined) {
            response = applyInlineFlag(meta, xregistryFlags.inline);
        }

        res.json(response);
    }));

    return router;
} 