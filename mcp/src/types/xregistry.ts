/**
 * xRegistry entity type definitions
 */

/**
 * Pagination response wrapper
 */
export interface PaginatedResponse<T> {
    data: T;
    links?: string[];
    count?: number;
}

/**
 * xRegistry resource (server) metadata
 */
export interface ServerMetadata {
    serverid: string;
    versionid: string;
    self: string;
    xid: string;
    epoch: number;
    name?: string;
    title?: string;
    description?: string;
    documentation?: string;
    icon?: string;
    labels?: Record<string, string>;
    createdat: string;
    modifiedat: string;
    isdefault: boolean;
    
    // MCP-specific attributes from server.json schema
    $schema?: string;
    version?: string;
    websiteUrl?: string;
    icons?: any[];
    packages?: any[];
    remotes?: any[];
    repository?: any;
    prompts?: any[];
    tools?: any[];
    resources?: any[];
    _meta?: any;
}

/**
 * xRegistry group (provider) metadata
 */
export interface ProviderMetadata {
    mcpproviderid: string;
    self: string;
    xid: string;
    epoch: number;
    name?: string;
    description?: string;
    documentation?: string;
    icon?: string;
    labels?: Record<string, string>;
    createdat: string;
    modifiedat: string;
    
    serversurl: string;
    serverscount: number;
    servers?: Record<string, ServerMetadata>;
}

/**
 * xRegistry root entity
 */
export interface RegistryMetadata {
    specversion: string;
    registryid: string;
    self: string;
    xid: string;
    epoch: number;
    name?: string;
    description?: string;
    documentation?: string;
    icon?: string;
    labels?: Record<string, string>;
    createdat: string;
    modifiedat: string;
    
    mcpprovidersurl: string;
    mcpproviderscount: number;
    mcpproviders?: Record<string, ProviderMetadata>;
}

/**
 * xRegistry model definition
 */
export interface RegistryModel {
    registryid: string;
    self: string;
    schema: string;
    model: any;
}

/**
 * Query options for filtering and sorting
 */
export interface QueryOptions {
    inline?: string[];
    filter?: string[];
    sort?: string;
    limit?: number;
    cursor?: string;
}
