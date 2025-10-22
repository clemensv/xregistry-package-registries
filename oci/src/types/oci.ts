/**
 * OCI Registry API v2 type definitions
 * Based on Docker Registry HTTP API V2 specification
 */

/**
 * OCI Registry API v2 catalog response
 */
export interface OCICatalogResponse {
    repositories: string[];
}

/**
 * OCI Registry API v2 tags list response
 */
export interface OCITagsResponse {
    name: string;
    tags: string[];
}

/**
 * OCI Image manifest (OCI Image Manifest Specification v1.0)
 */
export interface OCIManifest {
    schemaVersion: number;
    mediaType: string;
    config?: OCIDescriptor;
    layers?: OCIDescriptor[];
    manifests?: OCIDescriptor[];  // For manifest lists
    annotations?: Record<string, string>;
}

/**
 * OCI Content Descriptor
 */
export interface OCIDescriptor {
    mediaType: string;
    digest: string;
    size: number;
    urls?: string[];
    annotations?: Record<string, string>;
    data?: string;
    artifactType?: string;
    platform?: OCIPlatform;
}

/**
 * OCI Platform specification
 */
export interface OCIPlatform {
    architecture: string;
    os: string;
    'os.version'?: string;
    'os.features'?: string[];
    variant?: string;
}

/**
 * OCI Image configuration
 */
export interface OCIImageConfig {
    created?: string;
    author?: string;
    architecture: string;
    os: string;
    config?: OCIContainerConfig;
    rootfs: OCIRootFS;
    history?: OCIHistoryEntry[];
}

/**
 * OCI Container configuration
 */
export interface OCIContainerConfig {
    User?: string;
    ExposedPorts?: Record<string, object>;
    Env?: string[];
    Entrypoint?: string[];
    Cmd?: string[];
    Volumes?: Record<string, object>;
    WorkingDir?: string;
    Labels?: Record<string, string>;
    StopSignal?: string;
}

/**
 * OCI Root filesystem
 */
export interface OCIRootFS {
    type: string;
    diff_ids: string[];
}

/**
 * OCI History entry
 */
export interface OCIHistoryEntry {
    created?: string;
    created_by?: string;
    author?: string;
    comment?: string;
    empty_layer?: boolean;
}

/**
 * Docker Registry API v2 error response
 */
export interface OCIErrorResponse {
    errors: OCIError[];
}

/**
 * OCI/Docker Registry error detail
 */
export interface OCIError {
    code: string;
    message: string;
    detail?: unknown;
}

/**
 * OCI Backend configuration
 */
export interface OCIBackend {
    id: string;
    name: string;
    url: string;
    apiVersion: string;
    description?: string;
    enabled: boolean;
    public: boolean;
    username?: string;
    password?: string;
    token?: string;
    catalogPath?: string;
}

/**
 * Docker Hub authentication token response
 */
export interface DockerAuthTokenResponse {
    token: string;
    access_token?: string;
    expires_in?: number;
    issued_at?: string;
}

/**
 * Cached OCI response with ETag
 */
export interface CachedOCIResponse<T> {
    etag: string | null;
    data: T;
    timestamp: number;
}

/**
 * OCI cache metadata
 */
export interface OCICacheMetadata {
    lastUpdate: string;
    repositoryNames: string[];
    backends: string[];
}
