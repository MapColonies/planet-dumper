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
    'cli.schedule.runOnInit': false,
    ...overrides,
  };

  return {
    get: vi.fn((path: string) => (path in values ? values[path] : {})) as ConfigType['get'],
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
