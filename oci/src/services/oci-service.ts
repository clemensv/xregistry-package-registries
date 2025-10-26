/**
 * OCI Registry Service
 * @fileoverview Service for interacting with OCI Registry API v2
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as fs from 'fs';
import { EntityStateManager } from '../../../shared/entity-state-manager';
import { CACHE_CONFIG, OCI_REGISTRY } from '../config/constants';
import {
    DockerAuthTokenResponse,
    OCIBackend,
    OCICatalogResponse,
    OCIImageConfig,
    OCIManifest,
    OCITagsResponse,
} from '../types/oci';
import { ImageMetadata, VersionMetadata } from '../types/xregistry';
import { toRFC3339 } from '../utils/xregistry-utils';

export interface OCIServiceConfig {
    backends?: OCIBackend[];
    timeout?: number;
    userAgent?: string;
    cacheDir?: string;
    baseUrl?: string;
    entityState?: EntityStateManager;
}

export class OCIService {
    private httpClient: AxiosInstance;
    private cacheDir: string;
    private backends: OCIBackend[];
    private authTokens: Map<string, { token: string; expires: number }> = new Map();
    private baseUrl: string;
    private entityState: EntityStateManager;

    constructor(config: OCIServiceConfig = {}) {
        this.baseUrl = config.baseUrl || 'http://localhost:3400';
        this.entityState = config.entityState || new EntityStateManager();
        this.backends = config.backends || [{
            id: 'mcr.microsoft.com',
            name: 'Microsoft Container Registry',
            url: 'https://mcr.microsoft.com',
            apiVersion: 'v2',
            description: 'Microsoft Container Registry',
            enabled: true,
            public: true,
            catalogPath: '/v2/_catalog',
        }];
        this.cacheDir = config.cacheDir || CACHE_CONFIG.CACHE_DIR;
        this.httpClient = axios.create({
            timeout: config.timeout || OCI_REGISTRY.TIMEOUT_MS,
            headers: {
                'User-Agent': config.userAgent || OCI_REGISTRY.USER_AGENT,
                'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
            },
        });
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    private async getAuthToken(backend: OCIBackend, repository: string): Promise<string | null> {
        const cacheKey = `${backend.id}:${repository}`;
        const cached = this.authTokens.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
            return cached.token;
        }
        try {
            if (backend.id === 'docker.io') {
                const authUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`;
                const response = await axios.get<DockerAuthTokenResponse>(authUrl);
                if (response.data.token || response.data.access_token) {
                    const token = response.data.token || response.data.access_token!;
                    const expiresIn = response.data.expires_in || 300;
                    this.authTokens.set(cacheKey, {
                        token,
                        expires: Date.now() + (expiresIn * 1000),
                    });
                    return token;
                }
            }
            if (backend.token) {
                return backend.token;
            }
            return null;
        } catch (error) {
            console.warn(`Failed to get auth token for ${repository}:`, error);
            return null;
        }
    }

    private async ociRequest<T>(
        backend: OCIBackend,
        path: string,
        repository?: string
    ): Promise<{ body: T; headers: Record<string, string> }> {
        const url = `${backend.url}${path}`;
        const headers: Record<string, string> = {
            'User-Agent': OCI_REGISTRY.USER_AGENT,
        };
        if (repository) {
            const token = await this.getAuthToken(backend, repository);
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
        try {
            const response: AxiosResponse<T> = await this.httpClient.get(url, {
                headers,
                validateStatus: (status) => status < 500,
            });
            if (response.status >= 400) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return {
                body: response.data,
                headers: response.headers as Record<string, string>,
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`OCI request failed: ${error.message}`);
            }
            throw error;
        }
    }

    async listRepositories(backend: OCIBackend): Promise<string[]> {
        const catalogPath = backend.catalogPath || '/v2/_catalog';
        if (catalogPath === 'disabled') {
            return [];
        }
        try {
            const allRepositories: string[] = [];
            let fetchUrl = `${catalogPath}?n=1000`;
            while (fetchUrl) {
                const response = await this.ociRequest<OCICatalogResponse>(backend, fetchUrl);
                const catalog = response.body;
                if (catalog && catalog.repositories) {
                    allRepositories.push(...catalog.repositories);
                }
                const linkHeader = response.headers['link'];
                if (linkHeader) {
                    const nextLink = linkHeader.split(',').find((link: string) => link.includes('rel="next"'));
                    if (nextLink) {
                        const match = nextLink.match(/<([^>]+)>/);
                        if (match && match[1]) {
                            const nextUrlObject = new URL(match[1], backend.url);
                            fetchUrl = nextUrlObject.pathname + nextUrlObject.search;
                        } else {
                            fetchUrl = '';
                        }
                    } else {
                        fetchUrl = '';
                    }
                } else {
                    fetchUrl = '';
                }
            }
            return allRepositories;
        } catch (error) {
            console.error(`Failed to list repositories for ${backend.id}:`, error);
            return [];
        }
    }

    async listTags(backend: OCIBackend, repository: string): Promise<string[]> {
        try {
            const tagsPath = `/v2/${repository}/tags/list`;
            const response = await this.ociRequest<OCITagsResponse>(backend, tagsPath, repository);
            return response.body.tags || [];
        } catch (error) {
            console.error(`Failed to list tags for ${repository}:`, error);
            return [];
        }
    }

    async getManifest(backend: OCIBackend, repository: string, tag: string): Promise<OCIManifest | null> {
        try {
            const manifestPath = `/v2/${repository}/manifests/${tag}`;
            const response = await this.ociRequest<OCIManifest>(backend, manifestPath, repository);
            return response.body;
        } catch (error) {
            console.error(`Failed to get manifest for ${repository}:${tag}:`, error);
            return null;
        }
    }

    async getImageConfig(backend: OCIBackend, repository: string, configDigest: string): Promise<OCIImageConfig | null> {
        try {
            const blobPath = `/v2/${repository}/blobs/${configDigest}`;
            const response = await this.ociRequest<OCIImageConfig>(backend, blobPath, repository);
            return response.body;
        } catch (error) {
            console.error(`Failed to get image config for ${repository}:`, error);
            return null;
        }
    }

    async getImageMetadata(backend: OCIBackend, repository: string): Promise<ImageMetadata | null> {
        try {
            const tags = await this.listTags(backend, repository);
            if (tags.length === 0) {
                return null;
            }
            const latestTag = tags.includes('latest') ? 'latest' : tags[0];
            let manifest = await this.getManifest(backend, repository, latestTag!);
            if (!manifest) {
                return null;
            }

            // Handle manifest lists - get the first linux/amd64 manifest if available
            const isManifestList = manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
                manifest.mediaType === 'application/vnd.oci.image.index.v1+json';

            let availablePlatforms: Array<{ architecture: string; os: string; variant?: string; digest: string; size: number; mediaType: string }> | undefined;

            if (isManifestList && manifest.manifests) {
                // Store available platforms
                availablePlatforms = manifest.manifests.map(m => ({
                    architecture: m.platform?.architecture || 'unknown',
                    os: m.platform?.os || 'unknown',
                    ...(m.platform?.variant && { variant: m.platform.variant }),
                    digest: m.digest,
                    size: m.size,
                    mediaType: m.mediaType,
                }));

                // Try to get amd64/linux manifest for metadata
                const amd64Manifest = manifest.manifests.find(m =>
                    m.platform?.architecture === 'amd64' && m.platform?.os === 'linux'
                );
                if (amd64Manifest) {
                    // Fetch the actual manifest for this platform
                    manifest = await this.getManifest(backend, repository, amd64Manifest.digest) || manifest;
                }
            }

            // Get config for latest tag to populate image-level metadata
            let config: OCIImageConfig | null = null;
            if (manifest.config) {
                config = await this.getImageConfig(backend, repository, manifest.config.digest);
            }

            const versions: Record<string, VersionMetadata> = {};
            for (const tag of tags.slice(0, 10)) {
                const tagManifest = await this.getManifest(backend, repository, tag);
                if (tagManifest) {
                    versions[tag] = await this.convertToVersionMetadata(backend, repository, tag, tagManifest);
                }
            }

            // Extract namespace from repository (e.g., "library" from "library/nginx")
            const namespaceParts = repository.split('/');
            const namespace = namespaceParts.length > 1 ? namespaceParts[0] : undefined;

            // Calculate total size
            const totalSize = manifest.layers?.reduce((sum, layer) => sum + (layer.size || 0), 0) || 0;

            // Extract OCI labels from config
            const labels = config?.config?.Labels || {};
            const ociLabels = {
                version: labels['org.opencontainers.image.version'],
                revision: labels['org.opencontainers.image.revision'],
                source: labels['org.opencontainers.image.source'],
                documentation: labels['org.opencontainers.image.documentation'],
                licenses: labels['org.opencontainers.image.licenses'],
                vendor: labels['org.opencontainers.image.vendor'],
                authors: labels['org.opencontainers.image.authors'],
                url: labels['org.opencontainers.image.url'],
                title: labels['org.opencontainers.image.title'],
                created: labels['org.opencontainers.image.created'],
            };

            // Build history from config
            const buildHistory = config?.history?.map((historyItem, index) => ({
                step: index + 1,
                ...(historyItem.created && { created: historyItem.created }),
                ...(historyItem.created_by && { created_by: historyItem.created_by }),
                ...(historyItem.empty_layer !== undefined && { empty_layer: historyItem.empty_layer }),
                ...(historyItem.comment && { comment: historyItem.comment }),
            }));

            const resourcePath = `/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}`;

            return {
                // xRegistry REQUIRED attributes (common to all entities)
                xid: resourcePath,
                self: `${this.baseUrl}${resourcePath}`,
                epoch: this.entityState.getEpoch(resourcePath),
                createdat: this.entityState.getCreatedAt(resourcePath),
                modifiedat: this.entityState.getModifiedAt(resourcePath),

                // xRegistry REQUIRED Resource attributes
                imageid: encodeURIComponent(repository),
                versionid: latestTag!,  // REQUIRED: ID of the default Version
                isdefault: true as const, // REQUIRED: Always true for Resource

                // xRegistry OPTIONAL Resource attributes
                name: repository,
                description: `OCI image ${repository}`,
                versionsurl: `${this.baseUrl}/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/versions`,
                versionscount: tags.length,
                metaurl: `${this.baseUrl}/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/meta`,

                // Resource collection
                versions: versions,

                // OCI-specific metadata
                distTags: {
                    latest: latestTag!,
                },
                registry: backend.url,
                ...(namespace && { namespace }),
                repository: `${backend.url}/v2/${repository}`,
                metadata: {
                    ...(manifest.config?.digest && { digest: manifest.config.digest }),
                    ...(manifest.mediaType && { manifest_mediatype: manifest.mediaType }),
                    ...(manifest.schemaVersion && { schema_version: manifest.schemaVersion }),
                    ...(manifest.layers?.length && { layers_count: manifest.layers.length }),
                    ...(config?.architecture && { architecture: config.architecture }),
                    ...(config?.os && { os: config.os }),
                    ...(totalSize && { size_bytes: totalSize }),
                    is_multi_platform: manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
                        manifest.mediaType === 'application/vnd.oci.image.index.v1+json',
                    oci_labels: ociLabels,
                    ...(config?.config?.Env && { environment: config.config.Env }),
                    ...(config?.config?.WorkingDir && { working_dir: config.config.WorkingDir }),
                    ...(config?.config?.Entrypoint && { entrypoint: config.config.Entrypoint }),
                    ...(config?.config?.Cmd && { cmd: config.config.Cmd }),
                    ...(config?.config?.User && { user: config.config.User }),
                    ...(config?.config?.ExposedPorts && { exposed_ports: Object.keys(config.config.ExposedPorts) }),
                    ...(config?.config?.Volumes && { volumes: Object.keys(config.config.Volumes) }),
                    ...(availablePlatforms && availablePlatforms.length > 0 && { available_platforms: availablePlatforms }),
                },
                ...(manifest.layers && manifest.layers.length > 0 && {
                    layers: manifest.layers.map((layer) => ({
                        digest: layer.digest,
                        size: layer.size,
                        mediaType: layer.mediaType,
                    }))
                }),
                ...(buildHistory && buildHistory.length > 0 && { build_history: buildHistory }),
                urls: {
                    pull: `${backend.url}/${repository}:${latestTag}`,
                    manifest: `${backend.url}/v2/${repository}/manifests/${latestTag}`,
                    ...(manifest.config?.digest && { config: `${backend.url}/v2/${repository}/blobs/${manifest.config.digest}` }),
                },
                ...(manifest.annotations && { annotations: manifest.annotations }),
                ...(config?.created && { created: config.created }),
            };
        } catch (error) {
            console.error(`Failed to get image metadata for ${repository}:`, error);
            return null;
        }
    }

    async convertToVersionMetadata(backend: OCIBackend, repository: string, tag: string, manifest: OCIManifest): Promise<VersionMetadata> {
        // Handle manifest lists - get the linux/amd64 manifest if this is a manifest list
        const isManifestList = manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
            manifest.mediaType === 'application/vnd.oci.image.index.v1+json';

        let actualManifest = manifest;
        if (isManifestList && manifest.manifests) {
            // Try to get amd64/linux manifest
            const amd64Manifest = manifest.manifests.find(m =>
                m.platform?.architecture === 'amd64' && m.platform?.os === 'linux'
            );
            if (amd64Manifest) {
                const platformManifest = await this.getManifest(backend, repository, amd64Manifest.digest);
                if (platformManifest) {
                    actualManifest = platformManifest;
                }
            }
        }

        let config: OCIImageConfig | null = null;
        if (actualManifest.config) {
            config = await this.getImageConfig(backend, repository, actualManifest.config.digest);
        }

        // Determine if this is the default version (typically 'latest' tag)
        const isDefault = tag === 'latest';

        const versionPath = `/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/versions/${tag}`;

        return {
            // xRegistry REQUIRED attributes (common to all entities)
            xid: versionPath,
            self: `${this.baseUrl}${versionPath}`,
            epoch: this.entityState.getEpoch(versionPath),
            createdat: this.entityState.getCreatedAt(versionPath),
            modifiedat: this.entityState.getModifiedAt(versionPath),

            // xRegistry REQUIRED Version attributes
            versionid: tag,
            packageid: encodeURIComponent(repository),  // REQUIRED: Reference to parent Resource
            isdefault: isDefault,  // REQUIRED: Whether this is the default Version
            ancestor: tag,  // REQUIRED: For now, self-referencing (lineage not tracked in OCI)
            contenttype: 'application/vnd.oci.image.manifest.v1+json',  // REQUIRED: OCI manifest content type

            // xRegistry OPTIONAL Version attributes
            version: tag,  // Alias for versionid
            name: tag,
            description: `Tag ${tag} of ${repository}`,

            // OCI-specific version metadata
            ...(config?.created && { created: config.created }),
            ...(actualManifest.config?.size && { size: actualManifest.config.size }),
            ...(actualManifest.config?.digest && { digest: actualManifest.config.digest }),
            ...(config?.architecture && { architecture: config.architecture }),
            ...(config?.os && { os: config.os }),
            ...(actualManifest.layers && actualManifest.layers.length > 0 && {
                layers: actualManifest.layers.map((layer) => ({
                    digest: layer.digest,
                    size: layer.size,
                    mediaType: layer.mediaType,
                }))
            }),
            config: actualManifest.config ? {
                digest: actualManifest.config.digest,
                size: actualManifest.config.size,
                mediaType: actualManifest.config.mediaType,
            } : undefined,
            annotations: actualManifest.annotations,
            platform: config ? {
                architecture: config.architecture,
                os: config.os,
            } : undefined,
        };
    }

    async getVersionMetadata(backend: OCIBackend, repository: string, tag: string): Promise<VersionMetadata | null> {
        try {
            const manifest = await this.getManifest(backend, repository, tag);
            if (!manifest) {
                return null;
            }
            return await this.convertToVersionMetadata(backend, repository, tag, manifest);
        } catch (error) {
            console.error(`Failed to get version metadata for ${repository}:${tag}:`, error);
            return null;
        }
    }

    async imageExists(backend: OCIBackend, repository: string): Promise<boolean> {
        try {
            const tags = await this.listTags(backend, repository);
            return tags.length > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get Meta entity for a Resource (image)
     * The Meta entity contains Resource-level metadata separate from Version metadata
     */
    async getImageMeta(backend: OCIBackend, repository: string): Promise<import('../types/xregistry').Meta | null> {
        try {
            const tags = await this.listTags(backend, repository);
            if (tags.length === 0) {
                return null;
            }

            // Determine default version (typically 'latest')
            const defaultTag = tags.includes('latest') ? 'latest' : tags[0];
            const createdTimestamp = toRFC3339();

            // Build Meta entity
            const meta: import('../types/xregistry').Meta = {
                // xRegistry REQUIRED attributes (common)
                xid: `/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/meta`,
                self: `${this.baseUrl}/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/meta`,
                epoch: 1,
                createdat: createdTimestamp,
                modifiedat: createdTimestamp,

                // xRegistry REQUIRED Meta attributes
                // (none - all Meta attributes are OPTIONAL per spec)

                // xRegistry OPTIONAL Meta attributes
                readonly: true, // This is a read-only wrapper
                defaultversionid: defaultTag,
                defaultversionurl: `${this.baseUrl}/containerregistries/${backend.id}/images/${encodeURIComponent(repository)}/versions/${defaultTag}`,
                defaultversionsticky: false, // Latest tag can change

                // Additional metadata
                name: `${repository} metadata`,
                description: `Meta entity for OCI image ${repository}`,
            };

            return meta;
        } catch (error) {
            console.error(`Failed to get meta for ${repository}:`, error);
            return null;
        }
    }

    async tagExists(backend: OCIBackend, repository: string, tag: string): Promise<boolean> {
        try {
            const manifest = await this.getManifest(backend, repository, tag);
            return manifest !== null;
        } catch (error) {
            return false;
        }
    }

    getBackends(): OCIBackend[] {
        return this.backends.filter((b) => b.enabled);
    }

    getBackend(id: string): OCIBackend | undefined {
        return this.backends.find((b) => b.id === id && b.enabled);
    }

    async getImages(backend: OCIBackend, options: { limit?: number; offset?: number; query?: string; } = {}): Promise<{ images: string[]; total: number }> {
        const allRepos = await this.listRepositories(backend);
        let filtered = allRepos;
        if (options.query) {
            const query = options.query.toLowerCase();
            filtered = allRepos.filter((repo) => repo.toLowerCase().includes(query));
        }
        const total = filtered.length;
        const offset = options.offset || 0;
        const limit = options.limit || 50;
        const images = filtered.slice(offset, offset + limit);
        return { images, total };
    }

    async getTotalImageCount(backend: OCIBackend): Promise<number> {
        const repos = await this.listRepositories(backend);
        return repos.length;
    }
}