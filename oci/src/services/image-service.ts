/**
 * Image Service
 * @fileoverview Service for image operations with multi-backend support
 */

import { OCIBackend } from '../types/oci';
import { ImageMetadata, VersionMetadata } from '../types/xregistry';
import { OCIService } from './oci-service';

export interface ImageServiceOptions {
    ociService: OCIService;
    baseUrl?: string;
}

/**
 * Image service providing high-level operations across backends
 */
export class ImageService {
    private readonly ociService: OCIService;
    private readonly baseUrl: string;

    constructor(options: ImageServiceOptions) {
        this.ociService = options.ociService;
        this.baseUrl = options.baseUrl || 'http://localhost:3400';
    }

    /**
     * Get all backends
     */
    getBackends(): OCIBackend[] {
        return this.ociService.getBackends();
    }

    /**
     * Get backend by ID
     */
    getBackend(backendId: string): OCIBackend | undefined {
        return this.ociService.getBackend(backendId);
    }

    /**
     * Get all images from a specific backend
     */
    async getAllImages(
        backendId: string,
        filters: Record<string, string> = {},
        offset: number = 0,
        limit: number = 50
    ): Promise<{ images: ImageMetadata[]; totalCount: number }> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            throw new Error(`Backend '${backendId}' not found`);
        }

        const query = Object.keys(filters).length > 0 ? Object.values(filters).join(' ') : undefined;

        const options: { offset: number; limit: number; query?: string } = {
            offset,
            limit
        };
        if (query !== undefined) {
            options.query = query;
        }

        const result = await this.ociService.getImages(backend, options);

        // Convert repository names to full ImageMetadata
        const images: ImageMetadata[] = await Promise.all(
            result.images.map(async (repo) => {
                const metadata = await this.ociService.getImageMetadata(backend, repo);
                return metadata || this.createBasicImageMetadata(backend, repo);
            })
        );

        return {
            images,
            totalCount: result.total
        };
    }

    /**
     * Get image by name from backend
     */
    async getImage(backendId: string, imageName: string): Promise<ImageMetadata> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            throw new Error(`Backend '${backendId}' not found`);
        }

        const imageData = await this.ociService.getImageMetadata(backend, imageName);
        if (!imageData) {
            throw new Error(`Image '${imageName}' not found in backend '${backendId}'`);
        }
        return imageData;
    }

    /**
     * Get image versions (tags)
     */
    async getImageVersions(
        backendId: string,
        imageName: string,
        offset: number = 0,
        limit: number = 50
    ): Promise<{ versions: VersionMetadata[]; totalCount: number }> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            throw new Error(`Backend '${backendId}' not found`);
        }

        const tags = await this.ociService.listTags(backend, imageName);
        if (tags.length === 0) {
            throw new Error(`Image '${imageName}' not found in backend '${backendId}'`);
        }

        const startIndex = offset;
        const endIndex = Math.min(startIndex + limit, tags.length);
        const selectedTags = tags.slice(startIndex, endIndex);

        // Fetch version metadata for selected tags
        const versions: VersionMetadata[] = await Promise.all(
            selectedTags.map(async (tag) => {
                const versionData = await this.ociService.getVersionMetadata(backend, imageName, tag);
                return versionData || this.createBasicVersionMetadata(backend, imageName, tag);
            })
        );

        return {
            versions,
            totalCount: tags.length
        };
    }

    /**
     * Get specific version (tag) metadata
     */
    async getImageVersion(backendId: string, imageName: string, tag: string): Promise<VersionMetadata> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            throw new Error(`Backend '${backendId}' not found`);
        }

        const versionData = await this.ociService.getVersionMetadata(backend, imageName, tag);
        if (!versionData) {
            throw new Error(`Tag '${tag}' not found for image '${imageName}' in backend '${backendId}'`);
        }
        return versionData;
    }

    /**
     * Check if image exists
     */
    async imageExists(backendId: string, imageName: string): Promise<boolean> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            return false;
        }
        return await this.ociService.imageExists(backend, imageName);
    }

    /**
     * Check if version exists
     */
    async versionExists(backendId: string, imageName: string, tag: string): Promise<boolean> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            return false;
        }
        return await this.ociService.tagExists(backend, imageName, tag);
    }

    /**
     * Get total image count for backend
     */
    async getTotalImageCount(backendId: string): Promise<number> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            return 0;
        }
        return await this.ociService.getTotalImageCount(backend);
    }

    /**
     * Create basic image metadata when full metadata unavailable
     */
    private createBasicImageMetadata(backend: OCIBackend, repository: string): ImageMetadata {
        return {
            imageid: encodeURIComponent(repository),
            versionid: 'latest', // Default to 'latest'
            isdefault: true as const,
            name: repository,
            description: `OCI image ${repository}`,
            versions: {},
            distTags: {},
            repository: `${backend.url}/v2/${repository}`,
            xid: `/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}`,
            self: `${this.baseUrl}/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}`,
            epoch: 1,
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
        };
    }

    /**
     * Create basic version metadata when full metadata unavailable
     */
    private createBasicVersionMetadata(backend: OCIBackend, repository: string, tag: string): VersionMetadata {
        return {
            versionid: tag,
            isdefault: tag === 'latest', // REQUIRED: true if this is the default version
            version: tag,
            name: tag,
            description: `Tag ${tag} of ${repository}`,
            xid: `/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/versions/${tag}`,
            self: `${this.baseUrl}/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/versions/${tag}`,
            epoch: 1,
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
        };
    }

    /**
     * Get Meta entity for an image (Resource-level metadata)
     */
    async getImageMeta(backendId: string, imageName: string): Promise<import('../types/xregistry').Meta> {
        const backend = this.ociService.getBackend(backendId);
        if (!backend) {
            throw new Error(`Backend '${backendId}' not found`);
        }

        const meta = await this.ociService.getImageMeta(backend, imageName);
        if (!meta) {
            throw new Error(`Meta for image '${imageName}' not found in backend '${backendId}'`);
        }
        return meta;
    }
}
