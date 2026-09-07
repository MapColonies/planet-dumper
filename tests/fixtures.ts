import { vi } from 'vitest';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import axios from 'axios';
import { S3Client } from '@aws-sdk/client-s3';
import type { FsRepository } from '@src/fsRepository/fsRepository';
import { CreateManager } from '@src/commands/create/createManager';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { S3ClientWrapper } from '@src/s3client/s3Client';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';
import { S3_REGION } from '@common/constants';

// reconstructs a nested object from the flat dotted keys under `prefix` (e.g. prefix 'cli' picks up
// 'cli.stateSource', 'cli.dumpServer.endpoint', etc.), mirroring how the real config lib resolves a
// parent path - so `config.get('cli')` behaves the same as `config.get('cli.stateSource')` does
const getNestedValue = (values: Record<string, unknown>, prefix: string): Record<string, unknown> | undefined => {
  const dottedPrefix = `${prefix}.`;
  const nested: Record<string, unknown> = {};
  let matched = false;

  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(dottedPrefix)) {
      continue;
    }
    matched = true;

    const parts = key.slice(dottedPrefix.length).split('.');
    const leafKey = parts.pop();
    if (leafKey === undefined) {
      continue;
    }

    let cursor = nested;
    for (const part of parts) {
      cursor[part] = typeof cursor[part] === 'object' && cursor[part] !== null ? cursor[part] : {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[leafKey] = value;
  }

  return matched ? nested : undefined;
};

export const delay = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// unlisted paths (e.g. 'pgDump', 'postgres', read internally by PgDumpManager's constructor)
// fall back to {} so they stay safely no-op unless a test explicitly overrides them
export const buildConfig = (overrides: Record<string, unknown> = {}): ConfigType => {
  const values: Record<string, unknown> = {
    'cli.stateSource': '1',
    'cli.outputFormat': 'dump_{state}_{timestamp}.pbf',
    'cli.cleanupMode': 'none',
    'cli.resume': false,
    'cli.info': false,
    's3.endpoint': 'https://s3.example.com',
    's3.bucketName': 'bucket',
    's3.acl': 'private',
    'cli.dumpServer.endpoint': undefined,
    'cli.dumpServer.headers': [],
    'cli.schedule.target': 'pg_dump',
    'cli.schedule.cronExpression': '* * * * * *',
    ...overrides,
  };

  return {
    get: vi.fn((path: string) => (path in values ? values[path] : (getNestedValue(values, path) ?? {}))) as ConfigType['get'],
    getAll: vi.fn(),
    getConfigParts: vi.fn(),
    getResolvedOptions: vi.fn(),
    initializeMetrics: vi.fn(),
  };
};

export const buildFsRepository = (): FsRepository => ({
  createDirectoryIfNotAlreadyExists: vi.fn().mockResolvedValue(undefined),
  removeDirectory: vi.fn().mockResolvedValue(undefined),
  emptyDirectory: vi.fn().mockResolvedValue(undefined),
  listFilesInDirectory: vi.fn().mockResolvedValue([]),
  getFileSize: vi.fn().mockResolvedValue(0),
  createFileReadStream: vi.fn().mockReturnValue({}),
});

// a real, silent (enabled: false) pino instance rather than a hand-mocked object, so it satisfies
// the full Logger type without a cast; the common level methods are pre-spied (call-through preserved)
// so tests can assert on them directly, e.g. expect(logger.info).toHaveBeenCalledWith(...)
export const buildLogger = async (): Promise<Logger> => {
  const logger = await jsLogger({ enabled: false });
  vi.spyOn(logger, 'debug');
  vi.spyOn(logger, 'info');
  vi.spyOn(logger, 'warn');
  vi.spyOn(logger, 'error');
  return logger;
};

export const buildPgDumpManager = (
  logger: Logger,
  config: ConfigType = buildConfig(),
  fsRepository: FsRepository = buildFsRepository()
): PgDumpManager => new PgDumpManager(logger, config, axios.create(), fsRepository);

export const buildCreateManager = (
  logger: Logger,
  config: ConfigType = buildConfig(),
  fsRepository: FsRepository = buildFsRepository()
): CreateManager =>
  new CreateManager(logger, config, axios.create(), fsRepository, new S3ClientWrapper(logger, new S3Client({ region: S3_REGION }), config));

export const disabledArstotzkaConfig: ArstotzkaConfig = {
  enabled: false,
  services: { planetDumperPg: 'pg-service', planetDumperNg: 'ng-service' },
  mediator: {
    timeout: 1000,
    enableRetryStrategy: false,
    retryStrategy: {},
  },
};

export const enabledArstotzkaConfig: ArstotzkaConfig = {
  enabled: true,
  services: { planetDumperPg: 'pg-service', planetDumperNg: 'ng-service' },
  mediator: {
    timeout: 1000,
    enableRetryStrategy: false,
    retryStrategy: {},
    actiony: { url: 'http://actiony.example.com' },
    locky: { url: 'http://locky.example.com' },
  },
};
