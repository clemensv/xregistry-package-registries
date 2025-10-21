/**
 * TypeScript definitions for xRegistry protocol
 * Based on xRegistry specification 1.0-rc1
 * 
 * Ensures compliance with xRegistry core specification:
 * - All entities MUST have xid, self, epoch, createdat, modifiedat
 * - xid MUST be a path starting with /
 * - self MUST be an absolute URL
 * - epoch MUST be a positive integer
 * - Timestamps MUST be RFC3339 format
 */

export interface XRegistryEntity {
    xid: string;           // REQUIRED: Path identifier starting with /
    name?: string;         // OPTIONAL: Human readable name
    description?: string;  // OPTIONAL: Description
    epoch: number;         // REQUIRED: Positive integer for versioning
    createdat: string;     // REQUIRED: RFC3339 timestamp
    modifiedat: string;    // REQUIRED: RFC3339 timestamp  
    labels?: Record<string, string>;  // OPTIONAL: Key-value labels
    documentation?: string; // OPTIONAL: Documentation URL
    shortself?: string;    // OPTIONAL: Short self-reference
    self: string;          // REQUIRED: Absolute URL to this entity
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
    dotnetregistriesurl: string;
    dotnetregistriescount: number;
    dotnetregistries: string;
}

export interface Group extends XRegistryEntity {
    [key: string]: any; // For dynamic URL properties like packagesurl
}

export interface Resource extends XRegistryEntity {
    packageid: string;     // REQUIRED: Unique package identifier
    author?: string;       // OPTIONAL: Package author
    license?: string;      // OPTIONAL: License information
    homepage?: string;     // OPTIONAL: Homepage URL
    repository?: string;   // OPTIONAL: Repository URL
    keywords?: string[];   // OPTIONAL: Package keywords
    versionid?: string;    // OPTIONAL: Current/latest version ID
    versionsurl?: string;  // OPTIONAL: URL to versions collection
    metaurl?: string;      // OPTIONAL: URL to metadata
    docsurl?: string;      // OPTIONAL: URL to documentation
}

export interface Version extends XRegistryEntity {
    versionid: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

export interface Meta extends XRegistryEntity {
    readonly: boolean;     // REQUIRED: Whether the resource is read-only
    compatibility: string; // REQUIRED: Compatibility mode
    defaultversionid?: string;     // OPTIONAL: Default version identifier
    defaultversionurl?: string;    // OPTIONAL: URL to default version
    defaultversionsticky?: boolean; // OPTIONAL: Whether default version is sticky
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
 * NuGet Package metadata extending xRegistry Resource
 */
export interface PackageMetadata extends Omit<Resource, 'author' | 'repository'> {
    distTags: Record<string, string>;
    versions: Record<string, VersionMetadata>;
    time: Record<string, string>;
    maintainers?: Array<{ name: string; email: string }>;
    author?: { name: string; email?: string };
    repository?: {
        type: string;
        url: string;
    };
    homepage?: string;
    bugs?: {
        url?: string;
        email?: string;
    };
    license?: string;
    keywords?: string[];
    readme?: string;
    readmeFilename?: string;
    main?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    bundledDependencies?: string[];
    engines?: Record<string, string>;
    os?: string[];
    cpu?: string[];
}

/**
 * NuGet Version metadata extending xRegistry Version
 */
export interface VersionMetadata extends Version {
    version: string;
    main?: string;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    bundledDependencies?: string[];
    engines?: Record<string, string>;
    os?: string[];
    cpu?: string[];
    keywords?: string[];
    author?: { name: string; email?: string };
    license?: string;
    repository?: {
        type: string;
        url: string;
    };
    bugs?: {
        url?: string;
        email?: string;
    };
    homepage?: string;
    dist: {
        integrity?: string;
        shasum: string;
        tarball: string;
        fileCount?: number;
        unpackedSize?: number;
    };
    _id: string;
    _nodeVersion?: string;
    _NuGetVersion?: string;
    _nugetUser?: { name: string; email: string };
    _hasShrinkwrap?: boolean;
} 