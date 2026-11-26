import { type ConfigInstance, config } from '@map-colonies/config';
import { vectorPlanetDumperV2, type vectorPlanetDumperV2Type } from '@map-colonies/schemas';

type ConfigType = ConfigInstance<vectorPlanetDumperV2Type>;

let configInstance: ConfigType | undefined;

/**
 * Initializes the configuration by loading and validating it against the schema.
 * This should only be called from the instrumentation file.
 * planet-dumper has no config-server deployed yet, so this defaults to offline (local-file) mode -
 * set the CONFIG_OFFLINE_MODE environment variable to override.
 */
export async function initConfig(offlineMode = true): Promise<void> {
  configInstance = await config({
    schema: vectorPlanetDumperV2,
    offlineMode,
  });
}

export function getConfig(): ConfigType {
  if (!configInstance) {
    throw new Error('config not initialized');
  }
  return configInstance;
}

export type { ConfigType };
