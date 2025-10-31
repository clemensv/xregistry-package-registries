/**
 * MCP Registry API type definitions
 * Based on https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml
 */

/**
 * Repository metadata for MCP server source code
 */
export interface MCPRepository {
    /** Repository URL for browsing source code */
    url: string;
    /** Repository hosting service identifier (e.g., 'github', 'gitlab') */
    source: string;
    /** Repository identifier from the hosting service */
    id?: string;
    /** Optional relative path from repository root */
    subfolder?: string;
}

/**
 * Icon metadata for MCP server
 */
export interface MCPIcon {
    /** A standard URI pointing to an icon resource */
    src: string;
    /** Optional MIME type override */
    mimeType?: 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/svg+xml' | 'image/webp';
    /** Optional array of sizes (e.g., ['48x48', '96x96'] or ['any']) */
    sizes?: string[];
    /** Optional theme specifier ('light' or 'dark') */
    theme?: 'light' | 'dark';
}

/**
 * Transport types
 */
export type MCPTransportType = 'stdio' | 'streamable-http' | 'sse';

/**
 * Transport configuration
 */
export interface MCPTransport {
    type: MCPTransportType;
    url?: string;
    headers?: MCPKeyValueInput[];
}

/**
 * Input format types
 */
export type MCPInputFormat = 'string' | 'number' | 'boolean' | 'filepath';

/**
 * Base input definition
 */
export interface MCPInput {
    description?: string;
    isRequired?: boolean;
    format?: MCPInputFormat;
    value?: string;
    isSecret?: boolean;
    default?: string;
    placeholder?: string;
    choices?: string[];
}

/**
 * Input with variable substitution support
 */
export interface MCPInputWithVariables extends MCPInput {
    variables?: Record<string, MCPInput>;
}

/**
 * Key-value input (for headers and environment variables)
 */
export interface MCPKeyValueInput extends MCPInputWithVariables {
    name: string;
}

/**
 * Argument types
 */
export type MCPArgumentType = 'positional' | 'named';

/**
 * Input argument for package execution
 */
export interface MCPArgument extends MCPInputWithVariables {
    type: MCPArgumentType;
    name?: string;
    valueHint?: string;
    isRepeated?: boolean;
}

/**
 * Package registry types
 */
export type MCPRegistryType = 'npm' | 'pypi' | 'oci' | 'nuget' | 'mcpb';

/**
 * Runtime hints
 */
export type MCPRuntimeHint = 'npx' | 'uvx' | 'docker' | 'dnx';

/**
 * Package registry metadata
 */
export interface MCPPackage {
    /** Registry type (npm, pypi, oci, nuget, mcpb) */
    registryType: MCPRegistryType;
    /** xRegistry ID referencing the package in the corresponding registry (conditional on registryType) */
    packagexid?: string;
    /** Base URL of the package registry */
    registryBaseUrl?: string;
    /** Package identifier or name */
    identifier: string;
    /** Specific package version */
    version?: string;
    /** SHA-256 hash for integrity verification */
    fileSha256?: string;
    /** Runtime hint (npx, uvx, docker, dnx) */
    runtimeHint?: MCPRuntimeHint;
    /** Transport protocol configuration */
    transport: MCPTransport;
    /** Runtime arguments */
    runtimeArguments?: MCPArgument[];
    /** Package arguments */
    packageArguments?: MCPArgument[];
    /** Environment variables */
    environmentVariables?: MCPKeyValueInput[];
}

/**
 * Prompt argument definition
 */
export interface MCPPromptArgument {
    name: string;
    description?: string;
    required?: boolean;
}

/**
 * Prompt template definition
 */
export interface MCPPrompt {
    name: string;
    description?: string;
    arguments?: MCPPromptArgument[];
}

/**
 * Prompt argument definition
 */
export interface MCPPromptArgument {
    name: string;
    description?: string;
    required?: boolean;
}

/**
 * Prompt template definition
 */
export interface MCPPrompt {
    name: string;
    description?: string;
    arguments?: MCPPromptArgument[];
}

/**
 * Tool definition
 */
export interface MCPTool {
    name: string;
    description?: string;
    inputSchema?: any;
}

/**
 * Resource definition
 */
export interface MCPResource {
    uriTemplate?: string;
    name?: string;
    description?: string;
    mimeType?: string;
}

/**
 * Server detail schema (from server.json)
 */
export interface MCPServerDetail {
    /** JSON Schema URI for this server.json format */
    $schema?: string;
    /** Server name in reverse-DNS format */
    name: string;
    /** Clear human-readable explanation of server functionality */
    description: string;
    /** Optional human-readable title or display name */
    title?: string;
    /** Optional repository metadata */
    repository?: MCPRepository;
    /** Version string for this server */
    version: string;
    /** Optional URL to the server's homepage or documentation */
    websiteUrl?: string;
    /** Optional set of sized icons */
    icons?: MCPIcon[];
    /** Package configurations */
    packages?: MCPPackage[];
    /** Remote transport endpoints */
    remotes?: MCPTransport[];
    /** Static prompt templates */
    prompts?: MCPPrompt[];
    /** Tool definitions */
    tools?: MCPTool[];
    /** Data resources */
    resources?: MCPResource[];
    /** Extension metadata */
    _meta?: {
        'io.modelcontextprotocol.registry/publisher-provided'?: any;
        [key: string]: any;
    };
}

/**
 * Server response from MCP registry
 */
export interface MCPServerResponse {
    server: MCPServerDetail;
    _meta?: {
        'io.modelcontextprotocol.registry/official'?: {
            status?: 'active' | 'deprecated' | 'deleted';
            publishedAt?: string;
            updatedAt?: string;
            isLatest?: boolean;
        };
        [key: string]: any;
    };
}

/**
 * Server list response
 */
export interface MCPServerListResponse {
    servers: MCPServerResponse[];
    metadata?: {
        nextCursor?: string;
        count?: number;
    };
}

/**
 * Cache metadata
 */
export interface CacheMetadata {
    lastUpdated: number;
    serverCount: number;
    etag?: string;
}

/**
 * Cached response
 */
export interface CachedResponse<T> {
    data: T;
    etag: string | null;
    timestamp: number;
}
