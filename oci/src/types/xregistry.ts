/**
 * TypeScript definitions for xRegistry protocol
 * Based on xRegistry specification 1.0-rc2
 * 
 * Ensures compliance with xRegistry core specification:
 * - All entities MUST have xid, self, epoch, createdat, modifiedat
 * - xid MUST be a path starting with /
 * - self MUST be an absolute URL
 * - epoch MUST be an unsigned integer (increments on every update)
 * - Timestamps MUST be RFC3339 format, normalized to UTC
 */

export interface XRegistryEntity {
    xid: string;           // REQUIRED: Path identifier starting with /
    self: string;          // REQUIRED: Absolute URL to this entity
    epoch: number;         // REQUIRED: Unsigned integer for concurrency control
    createdat: string;     // REQUIRED: RFC3339 timestamp (UTC with Z suffix)
    modifiedat: string;    // REQUIRED: RFC3339 timestamp (UTC with Z suffix)
    name?: string;         // OPTIONAL: Human readable name
    description?: string;  // OPTIONAL: Description
    documentation?: string; // OPTIONAL: Documentation URL
    labels?: Record<string, string>;  // OPTIONAL: Key-value labels
    shortself?: string;    // OPTIONAL: Short self-reference
    icon?: string;         // OPTIONAL: Icon URL
    [key: string]: any;    // Allow additional properties for dynamic content
}

export interface Registry extends XRegistryEntity {
    specversion: string;
    registryid: string;
    capabilities: string;
    capabilitiesurl: string;
    model: string;
    modelurl: string;
    groups: string;
    containerregistriesurl: string;
    containerregistriescount: number;
    containerregistries: string;
}

export interface Group extends XRegistryEntity {
    [key: string]: any; // For dynamic URL properties like imagesurl
}

export interface Resource extends XRegistryEntity {
    imageid: string;       // REQUIRED: Unique image identifier (same as <RESOURCE>id)
    versionid: string;     // REQUIRED: ID of the default Version
    isdefault: true;       // REQUIRED: Always true for Resource (includes default Version attrs)
    description?: string;  // OPTIONAL: Image description
    homepage?: string;     // OPTIONAL: Homepage URL
    repository?: string;   // OPTIONAL: Repository URL
    ancestor?: string;     // OPTIONAL: ID of the Version this was derived from
    contenttype?: string;  // OPTIONAL: MIME type of the Resource document
    versionsurl?: string;  // OPTIONAL: URL to versions collection
    versionscount?: number; // OPTIONAL: Count of versions
    metaurl?: string;      // OPTIONAL: URL to metadata
    docsurl?: string;      // OPTIONAL: URL to documentation
}

export interface Version extends XRegistryEntity {
    versionid: string;     // REQUIRED: Unique version identifier
    isdefault: boolean;    // REQUIRED: Whether this is the default Version
    ancestor?: string;     // OPTIONAL: ID of the Version this was derived from
    contenttype?: string;  // OPTIONAL: MIME type of the Version document
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

export interface Meta extends XRegistryEntity {
    // Note: Meta entity has <RESOURCE>id, not separate metaid
    readonly?: boolean;     // OPTIONAL: Whether the resource is read-only
    compatibility?: string; // OPTIONAL: Compatibility mode
    compatibilityauthority?: string; // OPTIONAL: Authority for compatibility
    defaultversionid?: string;     // OPTIONAL: Default version identifier
    defaultversionurl?: string;    // OPTIONAL: URL to default version
    defaultversionsticky?: boolean; // OPTIONAL: Whether default version is sticky
    xref?: string;         // OPTIONAL: Cross-reference to another Resource
    deprecated?: {         // OPTIONAL: Deprecation information
        effective?: string;
        removal?: string;
        alternative?: string;
        docs?: string;
    };
}

export interface ErrorResponse {
    type: string;
    title: string;
    status: number;
    instance: string;
    detail?: string;
    data?: any;
}

export interface FilterExpression {
    attribute: string;
    operator: string;
    value: string;
}

export interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

export interface XRegistryGroupResponse {
    [key: string]: XRegistryEntity[];
}

export interface XRegistryResourceResponse {
    [key: string]: XRegistryEntity[];
}

export interface CacheStats {
    hitCount: number;
    missCount: number;
    hitRate: number;
    size: number;
    maxSize: number;
}

export type SortDirection = 'asc' | 'desc';

export interface SortParams {
    attribute: string;
    direction: SortDirection;
}

export interface InlineParams {
    depth: number;
    attributes: string[];
}

/**
 * OCI Image metadata extending xRegistry Resource
 * Represents a container image as an xRegistry Resource entity
 */
export interface ImageMetadata extends Omit<Resource, 'author'> {
    imageid: string;       // REQUIRED: Unique image identifier
    versionid: string;     // REQUIRED: ID of the default Version
    isdefault: true;       // REQUIRED: Always true (Resource includes default Version)
    name: string;
    description?: string;
    versions: Record<string, VersionMetadata>;
    versionsurl?: string;
    versionscount?: number;
    metaurl?: string;
    distTags?: Record<string, string>;
    registry?: string;
    namespace?: string;
    repository?: string;
    metadata?: {
        digest?: string;
        manifest_mediatype?: string;
        schema_version?: number;
        layers_count?: number;
        architecture?: string;
        os?: string;
        size_bytes?: number;
        is_multi_platform?: boolean;
        available_platforms?: Array<{
            architecture: string;
            os: string;
            variant?: string;
            digest: string;
            size: number;
            mediaType: string;
        }>;
        oci_labels?: {
            version?: string;
            revision?: string;
            source?: string;
            documentation?: string;
            licenses?: string;
            vendor?: string;
            authors?: string;
            url?: string;
            title?: string;
            created?: string;
        };
        environment?: string[];
        working_dir?: string;
        entrypoint?: string[];
        cmd?: string[];
        user?: string;
        exposed_ports?: string[];
        volumes?: string[];
    };
    layers?: Array<{
        digest: string;
        size: number;
        mediaType: string;
    }>;
    build_history?: Array<{
        step?: number;
        created?: string;
        created_by?: string;
        empty_layer?: boolean;
        comment?: string;
    }>;
    urls?: {
        pull?: string;
        manifest?: string;
        config?: string;
    };
    annotations?: Record<string, string>;
    vulnerabilities?: any;
    pushed?: string;
    pulled?: number;
    starred?: number;
    deprecated?: string;
    homepage?: string;
    license?: string;
    maintainers?: string[];
    created?: string | undefined;
    updated?: string;
    pullCount?: number;
}

/**
 * OCI Version/Tag metadata extending xRegistry Version
 * Represents a container image tag/version as an xRegistry Version entity
 */
export interface VersionMetadata extends Version {
    versionid: string;     // REQUIRED: Unique version identifier
    isdefault: boolean;    // REQUIRED: Whether this is the default Version
    version: string;       // Alias for versionid
    name?: string;
    description?: string;
    ancestor?: string;     // OPTIONAL: Parent version this was derived from
    created?: string | undefined;
    size?: number | undefined;
    digest?: string | undefined;
    architecture?: string | undefined;
    os?: string | undefined;
    layers?: Array<{
        digest: string;
        size: number;
        mediaType: string;
    }>;
    config?: {
        digest: string;
        size: number;
        mediaType: string;
    } | undefined;
    annotations?: Record<string, string> | undefined;
    platform?: {
        architecture: string;
        os: string;
        variant?: string;
    } | undefined;
} 