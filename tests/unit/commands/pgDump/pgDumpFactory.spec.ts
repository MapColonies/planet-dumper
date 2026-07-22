import { container } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pgDumpCommandFactory } from '@src/commands/pgDump/pgDumpFactory';
import { PG_DUMP_MANAGER_FACTORY } from '@src/commands/pgDump/pgDumpManagerFactory';
import { runPgDumpPipeline } from '@src/commands/common/pipelineRunner';
import { terminateChildren } from '@common/spawner';
import { EXIT_CODE, ExitCodes, SERVICES } from '@common/constants';
import { PgDumpError } from '@common/errors';
import type { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { buildConfig, disabledArstotzkaConfig } from '@tests/fixtures';

vi.mock('@src/commands/common/pipelineRunner', () => ({
  runPgDumpPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@common/spawner', () => ({
  terminateChildren: vi.fn(),
}));

const runPgDumpPipelineMock = vi.mocked(runPgDumpPipeline);
const terminateChildrenMock = vi.mocked(terminateChildren);

const buildLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

const buildDependencyContainer = (overrides: {
  config?: ReturnType<typeof buildConfig>;
  manager?: PgDumpManager;
  logger?: Logger;
}): DependencyContainer => {
  const logger = overrides.logger ?? buildLogger();
  const config = overrides.config ?? buildConfig();
  const manager = overrides.manager ?? ({} as PgDumpManager);

  const resolve = vi.fn((token: symbol) => {
    switch (token) {
      case SERVICES.LOGGER:
        return logger;
      case SERVICES.CONFIG:
        return config;
      case SERVICES.ARSTOTZKA:
        return disabledArstotzkaConfig;
      case PG_DUMP_MANAGER_FACTORY:
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
    ...overrides,
  });

describe('pgDumpCommandFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path', () => {
    it('runs the pg dump pipeline with arguments mapped from config and logs success', async () => {
      const logger = buildLogger();
      const dependencyContainer = buildDependencyContainer({ config: validConfig(), logger });
      const { handler } = pgDumpCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(runPgDumpPipelineMock).toHaveBeenCalledWith(
        {},
        { outputFormat: 'dump_{state}_{timestamp}.pbf', stateSource: '1', cleanupMode: 'none' },
        logger,
        disabledArstotzkaConfig
      );
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'finished command execution successfully' }));
      expect(terminateChildrenMock).not.toHaveBeenCalled();
    });
  });

  describe('Bad Path', () => {
    it('fails with the general error exit code, without running the pipeline, when stateSource is not a valid uri or number', async () => {
      const config = validConfig({ 'cli.stateSource': 'not-a-valid-source' });
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = buildDependencyContainer({ config });
      const { handler } = pgDumpCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(runPgDumpPipelineMock).not.toHaveBeenCalled();
      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
    });
  });

  describe('Sad Path', () => {
    it('terminates children and registers the error-specific exit code when the pipeline throws', async () => {
      runPgDumpPipelineMock.mockRejectedValue(new PgDumpError('pg_dump failed'));
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = buildDependencyContainer({ config: validConfig() });
      const { handler } = pgDumpCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.PG_DUMP_ERROR });
    });
  });
});
