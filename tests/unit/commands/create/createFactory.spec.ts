/* eslint-disable @typescript-eslint/naming-convention */
import { container } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommandFactory } from '@src/commands/create/createFactory';
import { CREATE_MANAGER_FACTORY } from '@src/commands/create/createManagerFactory';
import { runCreatePipeline } from '@src/commands/common/pipelineRunner';
import { terminateChildren } from '@common/spawner';
import { EXIT_CODE, ExitCodes, SERVICES } from '@common/constants';
import { PgDumpError } from '@common/errors';
import type { CreateManager } from '@src/commands/create/createManager';
import { buildConfig, disabledArstotzkaConfig } from '@tests/fixtures';

vi.mock('@src/commands/common/pipelineRunner', () => ({
  runCreatePipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@common/spawner', () => ({
  terminateChildren: vi.fn(),
}));

const runCreatePipelineMock = vi.mocked(runCreatePipeline);
const terminateChildrenMock = vi.mocked(terminateChildren);

const buildLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

const buildDependencyContainer = (overrides: {
  config?: ReturnType<typeof buildConfig>;
  manager?: CreateManager;
  logger?: Logger;
}): DependencyContainer => {
  const logger = overrides.logger ?? buildLogger();
  const config = overrides.config ?? buildConfig();
  const manager = overrides.manager ?? ({} as CreateManager);

  const resolve = vi.fn((token: symbol) => {
    switch (token) {
      case SERVICES.LOGGER:
        return logger;
      case SERVICES.CONFIG:
        return config;
      case SERVICES.ARSTOTZKA:
        return disabledArstotzkaConfig;
      case CREATE_MANAGER_FACTORY:
        return manager;
      default:
        throw new Error(`unexpected token resolved in test: ${String(token)}`);
    }
  });

  return { resolve } as unknown as DependencyContainer;
};

const validConfig = (overrides: Record<string, unknown> = {}): ReturnType<typeof buildConfig> =>
  buildConfig({
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
    ...overrides,
  });

describe('createCommandFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path', () => {
    it('runs the create pipeline with arguments mapped from config and logs success', async () => {
      const logger = buildLogger();
      const dependencyContainer = buildDependencyContainer({ config: validConfig(), logger });
      const { handler } = createCommandFactory(dependencyContainer);

      await handler({ _: [], $0: 'planet-dumper' });

      expect(runCreatePipelineMock).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          outputFormat: 'dump_{state}_{timestamp}.pbf',
          stateSource: '1',
          cleanupMode: 'none',
          resume: false,
          info: false,
          s3BucketName: 'bucket',
          s3Acl: 'private',
          dumpServerEndpoint: undefined,
          dumpServerHeaders: [],
        }),
        logger,
        disabledArstotzkaConfig
      );
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'finished command execution successfully' }));
      expect(terminateChildrenMock).not.toHaveBeenCalled();
    });
  });

  describe('Bad Path', () => {
    it('fails with the general error exit code, without running the pipeline, when stateSource is not a valid uri or number', async () => {
      const config = validConfig();
      vi.mocked(config.get).mockImplementation(((path: string) =>
        path === 'cli.stateSource' ? 'not-a-valid-source' : validConfig().get(path)) as never);
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = buildDependencyContainer({ config });
      const { handler } = createCommandFactory(dependencyContainer);

      await handler({ _: [], $0: 'planet-dumper' });

      expect(runCreatePipelineMock).not.toHaveBeenCalled();
      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
    });

    it('fails with the general error exit code, without running the pipeline, when s3 endpoint or bucket name is missing', async () => {
      const config = buildConfig({
        'cli.stateSource': '1',
        's3.endpoint': undefined,
        's3.bucketName': undefined,
      });
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = buildDependencyContainer({ config });
      const { handler } = createCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(runCreatePipelineMock).not.toHaveBeenCalled();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
    });
  });

  describe('Sad Path', () => {
    it('terminates children and registers the error-specific exit code when the pipeline throws', async () => {
      runCreatePipelineMock.mockRejectedValue(new PgDumpError('pg_dump failed'));
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = buildDependencyContainer({ config: validConfig() });
      const { handler } = createCommandFactory(dependencyContainer);

      await handler({ _: [], $0: 'planet-dumper' });

      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.PG_DUMP_ERROR });
    });
  });
});
