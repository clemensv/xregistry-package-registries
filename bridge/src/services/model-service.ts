/**
 * Model consolidation service
 * Consolidates models and capabilities from multiple downstream servers
 */

import { incrementBridgeEpoch } from '../config/constants';
import { ConsolidatedCapabilities, ConsolidatedModel, DownstreamConfig, ServerState } from '../types/bridge';

export class ModelService {
    private consolidatedModel: ConsolidatedModel = {};
    private consolidatedCapabilities: ConsolidatedCapabilities = {};
    private groupTypeToBackend: Record<string, DownstreamConfig> = {};

    constructor(private readonly logger: any) { }

    /**
     * Get the consolidated model
     */
    getConsolidatedModel(): ConsolidatedModel {
        return this.consolidatedModel;
    }

    /**
     * Get the consolidated capabilities
     */
    getConsolidatedCapabilities(): ConsolidatedCapabilities {
        return this.consolidatedCapabilities;
    }

    /**
     * Get group type to backend mapping
     */
    getGroupTypeToBackend(): Record<string, DownstreamConfig> {
        return this.groupTypeToBackend;
    }

    /**
     * Get backend server for a specific group type
     */
    getBackendForGroup(groupType: string): DownstreamConfig | undefined {
        return this.groupTypeToBackend[groupType];
    }

    /**
     * Rebuild consolidated model from active servers
     */
    rebuildConsolidatedModel(serverStates: Map<string, ServerState>): boolean {
        const previousGroups = Object.keys(this.groupTypeToBackend);

        // Reset consolidated state
        this.consolidatedModel = {};
        this.consolidatedCapabilities = {};
        this.groupTypeToBackend = {};

        // Rebuild from active servers
        for (const [url, state] of serverStates) {
            if (state.isActive && state.model && state.capabilities) {
                const { model, capabilities } = state;

                // Merge models - merge groups instead of overwriting
                if (model.groups) {
                    if (!this.consolidatedModel.groups) {
                        this.consolidatedModel.groups = {};
                    }
                    this.consolidatedModel.groups = {
                        ...this.consolidatedModel.groups,
                        ...model.groups
                    };
                }

                // Merge other model properties
                this.consolidatedModel = {
                    ...this.consolidatedModel,
                    ...model,
                    groups: this.consolidatedModel.groups // Preserve merged groups
                };

                this.consolidatedCapabilities = {
                    ...this.consolidatedCapabilities,
                    ...capabilities
                };

                // Update group mappings
                if (model.groups) {
                    for (const groupType of Object.keys(model.groups)) {
                        if (this.groupTypeToBackend[groupType]) {
                            this.logger.warn('Group type collision detected', {
                                groupType,
                                existingServer: this.groupTypeToBackend[groupType].url,
                                newServer: url
                            });
                        }
                        this.groupTypeToBackend[groupType] = state.server;
                    }
                }
            }
        }

        const currentGroups = Object.keys(this.groupTypeToBackend);
        const hasChanges = previousGroups.length !== currentGroups.length ||
            !previousGroups.every(group => currentGroups.includes(group));

        if (hasChanges) {
            this.logger.info('Consolidated model updated', {
                availableGroups: currentGroups,
                activeServers: Array.from(serverStates.values())
                    .filter(s => s.isActive)
                    .map(s => s.server.url)
            });

            // Increment epoch on model changes
            incrementBridgeEpoch();
        }

        return hasChanges;
    }

    /**
     * Get available group types
     */
    getAvailableGroups(): string[] {
        return Object.keys(this.groupTypeToBackend);
    }

    /**
     * Check if a group type is available
     */
    isGroupAvailable(groupType: string): boolean {
        return !!this.groupTypeToBackend[groupType];
    }
}
