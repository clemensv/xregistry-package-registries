/**
 * Health monitoring service
 * Provides health check and status information
 */

import { ServerState, BridgeHealth, BridgeStatus, DownstreamHealth, ServerStatus, DownstreamConfig } from '../types/bridge';
import { RETRY_INTERVAL } from '../config/constants';
import { DownstreamService } from './downstream-service';
import { ModelService } from './model-service';

export class HealthService {
  constructor(
    private readonly downstreamService: DownstreamService,
    private readonly modelService: ModelService,
    private readonly logger: any
  ) {}

  /**
   * Get comprehensive health status
   */
  async getHealth(): Promise<BridgeHealth> {
    const serverStates = this.downstreamService.getServerStates();
    const groupTypeToBackend = this.modelService.getGroupTypeToBackend();

    const healthChecks = Array.from(serverStates.values()).map(async (state) => {
      const isCurrentlyHealthy = await this.downstreamService.checkServerHealth(state.server);
      
      return {
        url: state.server.url,
        healthy: isCurrentlyHealthy,
        active: state.isActive,
        lastAttempt: new Date(state.lastAttempt).toISOString(),
        error: state.error,
        groups: Object.keys(groupTypeToBackend).filter(groupType => 
          groupTypeToBackend[groupType].url === state.server.url
        )
      } as DownstreamHealth;
    });
    
    const serverHealth = await Promise.all(healthChecks);
    const hasActiveServers = this.downstreamService.getActiveServers().length > 0;
    
    return {
      status: hasActiveServers ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      activeServers: this.downstreamService.getActiveServers().length,
      totalServers: serverStates.size,
      downstreams: serverHealth,
      consolidatedGroups: Object.keys(groupTypeToBackend),
      retryInterval: RETRY_INTERVAL
    };
  }

  /**
   * Get detailed status information
   */
  getStatus(): BridgeStatus {
    const serverStates = this.downstreamService.getServerStates();
    const groupTypeToBackend = this.modelService.getGroupTypeToBackend();
    const consolidatedModel = this.modelService.getConsolidatedModel();

    const serverStatus: ServerStatus[] = Array.from(serverStates.values()).map(state => ({
      url: state.server.url,
      active: state.isActive,
      lastAttempt: new Date(state.lastAttempt).toISOString(),
      error: state.error,
      hasModel: !!state.model,
      groups: state.model?.groups ? Object.keys(state.model.groups) : []
    }));
    
    return {
      timestamp: new Date().toISOString(),
      servers: serverStatus,
      consolidatedModel,
      groupMappings: Object.keys(groupTypeToBackend).reduce((acc, groupType) => {
        acc[groupType] = groupTypeToBackend[groupType].url;
        return acc;
      }, {} as Record<string, string>),
      configuration: {
        startupWaitTime: parseInt(process.env['STARTUP_WAIT_TIME'] || '60000'),
        retryInterval: RETRY_INTERVAL,
        serverHealthTimeout: parseInt(process.env['SERVER_HEALTH_TIMEOUT'] || '10000')
      }
    };
  }
}
