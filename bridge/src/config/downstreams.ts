/**
 * Downstream server configuration management
 */

import fs from 'fs';
import { DownstreamConfig, DownstreamsConfig } from '../types/bridge';
import { CONFIG_FILE, DOWNSTREAMS_JSON } from './constants';

/**
 * Load downstream server configuration from environment or file
 */
export function loadDownstreamConfig(logger?: any): DownstreamConfig[] {
    // First try to read from environment variable (useful for container deployments)
    if (DOWNSTREAMS_JSON) {
        logger?.info('Loading downstream configuration from DOWNSTREAMS_JSON environment variable', {
            configLength: DOWNSTREAMS_JSON.length,
            source: 'environment'
        });

        try {
            const config: DownstreamsConfig = JSON.parse(DOWNSTREAMS_JSON);
            const servers = config.servers || [];

            logger?.info('Parsed downstream configuration', {
                serverCount: servers.length,
                servers: servers.map((s: DownstreamConfig) => ({ url: s.url, hasApiKey: !!s.apiKey }))
            });

            return servers;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger?.error('Failed to parse DOWNSTREAMS_JSON environment variable', {
                error: errorMessage,
                configPreview: DOWNSTREAMS_JSON.substring(0, 100) + '...'
            });
            throw new Error('Invalid DOWNSTREAMS_JSON format');
        }
    }

    // Fallback to file-based configuration
    logger?.info('Loading downstream configuration from file', { configFile: CONFIG_FILE, source: 'file' });

    try {
        const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config: DownstreamsConfig = JSON.parse(fileContent);
        const servers = config.servers || [];

        logger?.info('Loaded configuration from file', {
            configFile: CONFIG_FILE,
            serverCount: servers.length,
            servers: servers.map((s: DownstreamConfig) => ({ url: s.url, hasApiKey: !!s.apiKey }))
        });

        return servers;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger?.error('Failed to read configuration file', {
            configFile: CONFIG_FILE,
            error: errorMessage,
            cwd: process.cwd(),
            configExists: fs.existsSync(CONFIG_FILE)
        });
        throw new Error(`Configuration file ${CONFIG_FILE} not found or invalid`);
    }
}
