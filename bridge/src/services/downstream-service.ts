/**
 * Downstream server management service
 * Handles health checks, model fetching, and server state management
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DownstreamConfig, ServerState, ServerTestResult } from '../types/bridge';
import { SERVER_HEALTH_TIMEOUT } from '../config/constants';

export class DownstreamService {
  private serverStates: Map<string, ServerState> = new Map();
  
  constructor(
    private readonly downstreams: DownstreamConfig[],
    private readonly logger: any
  ) {
    // Initialize server states
    for (const server of downstreams) {
      this.serverStates.set(server.url, {
        server,
        isActive: false,
        lastAttempt: 0,
        consecutiveFailures: 0
      });
    }
  }

  /**
   * Get all server states
   */
  getServerStates(): Map<string, ServerState> {
    return this.serverStates;
  }

  /**
   * Get active server states
   */
  getActiveServers(): ServerState[] {
    return Array.from(this.serverStates.values()).filter(state => state.isActive);
  }

  /**
   * Get inactive server states
   */
  getInactiveServers(): ServerState[] {
    return Array.from(this.serverStates.values()).filter(state => !state.isActive);
  }

  /**
   * Test server connectivity and fetch model
   */
  async testServer(server: DownstreamConfig, req?: any): Promise<ServerTestResult | null> {
    const startTime = Date.now();
    const headers: Record<string, string> = {};
    
    try {
      if (server.apiKey) {
        headers['Authorization'] = `Bearer ${server.apiKey}`;
      }

      // Add distributed tracing headers if we have a request context
      if (req && req.logger) {
        const traceHeaders = req.logger.createDownstreamHeaders ? 
          req.logger.createDownstreamHeaders(req) : {};
        Object.assign(headers, traceHeaders);
      } else {
        // Generate trace context for internal calls
        const traceId = uuidv4().replace(/-/g, '');
        const spanId = uuidv4().replace(/-/g, '').substring(0, 16);
        headers['x-correlation-id'] = uuidv4();
        headers['traceparent'] = `00-${traceId}-${spanId}-01`;
      }

      this.logger.debug('Testing server connectivity', { 
        serverUrl: server.url,
        traceHeaders: Object.keys(headers).filter(h => h.startsWith('x-') || h === 'traceparent')
      });
      
      // First test root endpoint to get counts and general info
      const rootResponse = await axios.get(server.url, { 
        headers, 
        timeout: SERVER_HEALTH_TIMEOUT 
      });
      
      // Test /model endpoint specifically
      const modelResponse = await axios.get(`${server.url}/model`, { 
        headers, 
        timeout: SERVER_HEALTH_TIMEOUT 
      });
      
      // If model endpoint works, get capabilities too
      const capabilitiesResponse = await axios.get(`${server.url}/capabilities`, { 
        headers, 
        timeout: SERVER_HEALTH_TIMEOUT 
      });

      const duration = Date.now() - startTime;
      this.logger.info('Server connectivity test successful', { 
        serverUrl: server.url,
        duration,
        modelGroups: Object.keys(modelResponse.data.groups || {}).length,
        rootEndpointInfo: Object.keys(rootResponse.data)
          .filter(key => key.endsWith('count') || key.endsWith('url'))
          .reduce((acc: Record<string, any>, key: string) => { 
            acc[key] = rootResponse.data[key]; 
            return acc; 
          }, {}),
        traceId: headers['x-trace-id'] || 'generated',
        correlationId: headers['x-correlation-id']
      });
      
      // Merge root response data into model data to capture counts
      Object.keys(rootResponse.data)
        .filter(key => key.endsWith('count'))
        .forEach(countKey => {
          modelResponse.data[countKey] = rootResponse.data[countKey];
        });
      
      return {
        model: modelResponse.data,
        capabilities: capabilitiesResponse.data,
        rootResponse: rootResponse.data
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Server connectivity test failed', { 
        serverUrl: server.url,
        duration,
        error: error instanceof Error ? error.message : String(error),
        traceId: headers['x-trace-id'] || 'generated',
        correlationId: headers['x-correlation-id']
      });
      return null;
    }
  }

  /**
   * Check if a server is healthy (basic connectivity check)
   */
  async checkServerHealth(server: DownstreamConfig): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (server.apiKey) {
        headers['Authorization'] = `Bearer ${server.apiKey}`;
      }

      await axios.get(`${server.url}/health`, { 
        headers, 
        timeout: SERVER_HEALTH_TIMEOUT 
      });
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update server state after testing
   */
  updateServerState(url: string, result: ServerTestResult | null, error?: string): void {
    const state = this.serverStates.get(url);
    if (!state) return;

    state.lastAttempt = Date.now();

    if (result) {
      state.isActive = true;
      state.model = result.model;
      state.capabilities = result.capabilities;
      state.error = undefined;
      state.consecutiveFailures = 0;
      
      this.logger.info('Server activated', { 
        url, 
        groups: Object.keys(result.model.groups || {}) 
      });
    } else {
      state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
      state.error = error || 'Connection failed';
      
      // Only deactivate if it was previously active
      if (state.isActive) {
        state.isActive = false;
        this.logger.warn('Server deactivated', { 
          url, 
          error: state.error,
          consecutiveFailures: state.consecutiveFailures 
        });
      }
    }
  }

  /**
   * Retry all inactive servers
   */
  async retryInactiveServers(): Promise<boolean> {
    const inactiveServers = this.getInactiveServers();
    
    if (inactiveServers.length === 0) {
      return false;
    }

    this.logger.info('Retrying inactive servers', { 
      count: inactiveServers.length,
      servers: inactiveServers.map(s => s.server.url)
    });

    let hasChanges = false;

    for (const state of inactiveServers) {
      const result = await this.testServer(state.server);
      const wasInactive = !state.isActive;
      
      this.updateServerState(state.server.url, result, result ? undefined : 'Retry failed');
      
      // If server became active, we have changes
      if (wasInactive && state.isActive) {
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  /**
   * Initialize all downstream servers
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing downstream servers', { 
      count: this.downstreams.length,
      servers: this.downstreams.map(s => s.url)
    });

    const initPromises = this.downstreams.map(async (server) => {
      const result = await this.testServer(server);
      this.updateServerState(server.url, result, result ? undefined : 'Initial connection failed');
    });

    await Promise.all(initPromises);

    const activeCount = this.getActiveServers().length;
    this.logger.info('Downstream initialization complete', { 
      activeServers: activeCount,
      totalServers: this.downstreams.length
    });
  }
}
