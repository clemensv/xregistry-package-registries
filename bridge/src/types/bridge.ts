/**
 * Bridge-specific type definitions
 */

/**
 * Configuration for a downstream xRegistry server
 */
export interface DownstreamConfig {
  url: string;
  apiKey?: string;
}

/**
 * Configuration file structure for downstream servers
 */
export interface DownstreamsConfig {
  servers: DownstreamConfig[];
}

/**
 * Runtime state tracking for a downstream server
 */
export interface ServerState {
  server: DownstreamConfig;
  isActive: boolean;
  lastAttempt: number;
  model?: any;
  capabilities?: any;
  error?: string;
  consecutiveFailures?: number;
}

/**
 * Result from testing server connectivity
 */
export interface ServerTestResult {
  model: any;
  capabilities: any;
  rootResponse?: any;
}

/**
 * Consolidated model from all active downstream servers
 */
export interface ConsolidatedModel {
  groups?: Record<string, any>;
  [key: string]: any;
}

/**
 * Consolidated capabilities from all active downstream servers
 */
export interface ConsolidatedCapabilities {
  [key: string]: any;
}

/**
 * Health check result for a downstream server
 */
export interface DownstreamHealth {
  url: string;
  healthy: boolean;
  active: boolean;
  lastAttempt: string;
  error?: string;
  groups: string[];
}

/**
 * Overall bridge health status
 */
export interface BridgeHealth {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  activeServers: number;
  totalServers: number;
  downstreams: DownstreamHealth[];
  consolidatedGroups: string[];
  retryInterval: number;
}

/**
 * Bridge status information
 */
export interface BridgeStatus {
  timestamp: string;
  servers: ServerStatus[];
  consolidatedModel: ConsolidatedModel;
  groupMappings: Record<string, string>;
  configuration: BridgeConfiguration;
}

/**
 * Status of an individual downstream server
 */
export interface ServerStatus {
  url: string;
  active: boolean;
  lastAttempt: string;
  error?: string;
  hasModel: boolean;
  groups: string[];
}

/**
 * Bridge configuration settings
 */
export interface BridgeConfiguration {
  startupWaitTime: number;
  retryInterval: number;
  serverHealthTimeout: number;
}

/**
 * User principal extracted from Azure Container Apps headers
 */
export interface UserPrincipal {
  userId?: string;
  claims?: Array<{
    typ: string;
    val: string;
  }>;
  [key: string]: any;
}

/**
 * Enhanced request with user context
 */
export interface AuthenticatedRequest {
  user?: UserPrincipal;
  logger?: any;
  path: string;
  hostname: string;
  ip: string;
  method: string;
  url: string;
  headers: any;
  get(name: string): string | undefined;
  traceId?: string;
  correlationId?: string;
  requestId?: string;
}
