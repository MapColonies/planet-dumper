import { container } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { getTasks } from 'node-cron';
import type * as nodeCronModule from 'node-cron';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleCommandFactory } from '@src/commands/schedule/scheduleFactory';
import { RunInProgressError } from '@src/httpServer/httpServerFactory';
import type * as httpServerFactoryModule from '@src/httpServer/httpServerFactory';
import { runCreatePipeline, runPgDumpPipeline } from '@src/commands/common/pipelineRunner';
import { terminateChildren } from '@common/spawner';
import { EXIT_CODE, ExitCodes, SERVICES } from '@common/constants';
import { CreateManager } from '@src/commands/create/createManager';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { buildConfig, buildCreateManager, buildLogger, buildPgDumpManager, disabledArstotzkaConfig } from '@tests/fixtures';

interface CapturedTriggers {
  runPgDump: () => Promise<void>;
  runCreate: (stateSource?: string) => Promise<void>;
}

// a cron expression that only fires once a year - schedule() itself is mocked below (never really ticks),
// but cronExpressionCheck still validates this for real, so it has to be a genuinely valid expression
const NEVER_DURING_TEST_CRON = '0 0 0 1 1 *';

vi.mock('@src/commands/common/pipelineRunner', () => ({
  runCreatePipeline: vi.fn().mockResolvedValue(undefined),
  runPgDumpPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@common/spawner', () => ({
  terminateChildren: vi.fn(),
}));

const { httpServerFactoryMock, getCapturedTriggers } = vi.hoisted(() => {
  let capturedTriggers: CapturedTriggers | undefined;
  const httpServerFactoryMock = vi.fn((logger: unknown, triggers: CapturedTriggers) => {
    capturedTriggers = triggers;
    return {
      listen: (port: number, cb?: () => void) => {
        cb?.();
        return { close: (closeCb?: () => void) => closeCb?.() };
      },
    };
  });
  return { httpServerFactoryMock, getCapturedTriggers: (): CapturedTriggers | undefined => capturedTriggers };
});

vi.mock('@src/httpServer/httpServerFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof httpServerFactoryModule>();
  return { ...actual, httpServerFactory: httpServerFactoryMock };
});

const { cronScheduleMock, getCapturedCronTick } = vi.hoisted(() => {
  let capturedCronTick: (() => Promise<void>) | undefined;
  const stubTask = { on: vi.fn(), stop: vi.fn() };
  const cronScheduleMock = vi.fn((expression: string, callback: () => Promise<void>) => {
    capturedCronTick = callback;
    return stubTask;
  });
  return { cronScheduleMock, getCapturedCronTick: (): (() => Promise<void>) | undefined => capturedCronTick };
});

vi.mock('node-cron', async (importOriginal) => {
  const actual = await importOriginal<typeof nodeCronModule>();
  return { ...actual, schedule: cronScheduleMock };
});

const runCreatePipelineMock = vi.mocked(runCreatePipeline);
const runPgDumpPipelineMock = vi.mocked(runPgDumpPipeline);
const terminateChildrenMock = vi.mocked(terminateChildren);

const buildDependencyContainer = async (overrides: {
  config?: ReturnType<typeof buildConfig>;
  createManager?: CreateManager;
  pgDumpManager?: PgDumpManager;
  logger?: Logger;
}): Promise<DependencyContainer> => {
  const logger = overrides.logger ?? (await buildLogger());
  const config = overrides.config ?? buildConfig();
  const createManager = overrides.createManager ?? buildCreateManager(logger, config);
  const pgDumpManager = overrides.pgDumpManager ?? buildPgDumpManager(logger, config);

  const dependencyContainer = container.createChildContainer();
  dependencyContainer.register(SERVICES.LOGGER, { useValue: logger });
  dependencyContainer.register(SERVICES.CONFIG, { useValue: config });
  dependencyContainer.register(SERVICES.ARSTOTZKA, { useValue: disabledArstotzkaConfig });
  dependencyContainer.register(CreateManager, { useValue: createManager });
  dependencyContainer.register(PgDumpManager, { useValue: pgDumpManager });

  return dependencyContainer;
};

// this file's own cron override (fires once a year), not shared with the rest of the suite
const validConfig = (overrides: Record<string, unknown> = {}): ReturnType<typeof buildConfig> =>
  buildConfig({ 'cli.schedule.cronExpression': NEVER_DURING_TEST_CRON, ...overrides });

// NOTE: this must not create-and-return the handler's promise itself - an async function that
// `return`s a promise implicitly awaits it before its own caller gets control back, which would
// deadlock here (the promise only resolves after SIGTERM, which the caller sends *after* arming).
const waitForArmed = async (logger: Logger): Promise<void> => {
  await vi.waitFor(() => {
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduler armed, waiting for ticks' }));
  });
};

const shutdown = async (handlerPromise: Promise<void>): Promise<void> => {
  process.emit('SIGTERM');
  await handlerPromise;
};

describe('scheduleCommandFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    getTasks().forEach((task) => {
      void task.destroy();
    });
  });

  describe('Happy Path', () => {
    it('runs the pg_dump pipeline when triggered via the http api', async () => {
      const logger = await buildLogger();
      const config = validConfig({ 'cli.schedule.target': 'pg_dump' });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await getCapturedTriggers()?.runPgDump();
      await shutdown(handlerPromise);

      expect(runPgDumpPipelineMock).toHaveBeenCalledWith(
        expect.any(PgDumpManager),
        { outputFormat: 'dump_{state}_{timestamp}.pbf', stateSource: '1', cleanupMode: 'none' },
        logger,
        disabledArstotzkaConfig
      );
      expect(runCreatePipelineMock).not.toHaveBeenCalled();
    });

    it('runs the create pipeline with s3 args when triggered via the http api, using config stateSource by default', async () => {
      const logger = await buildLogger();
      const config = validConfig({
        'cli.schedule.target': 'create',
        'cli.resume': false,
        'cli.info': false,
        's3.bucketName': 'bucket',
        's3.acl': 'private',
        'cli.dumpServer.endpoint': undefined,
        'cli.dumpServer.headers': [],
      });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await getCapturedTriggers()?.runCreate();
      await shutdown(handlerPromise);

      expect(runCreatePipelineMock).toHaveBeenCalledWith(
        expect.any(CreateManager),
        expect.objectContaining({ outputFormat: 'dump_{state}_{timestamp}.pbf', stateSource: '1', s3BucketName: 'bucket', s3Acl: 'private' }),
        logger,
        disabledArstotzkaConfig
      );
      expect(runPgDumpPipelineMock).not.toHaveBeenCalled();
    });

    it('runs the create pipeline with a stateSource override from the api instead of config', async () => {
      const logger = await buildLogger();
      const config = validConfig({
        'cli.schedule.target': 'create',
        'cli.resume': false,
        'cli.info': false,
        's3.bucketName': 'bucket',
        's3.acl': 'private',
        'cli.dumpServer.endpoint': undefined,
        'cli.dumpServer.headers': [],
      });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await getCapturedTriggers()?.runCreate('999');
      await shutdown(handlerPromise);

      expect(runCreatePipelineMock).toHaveBeenCalledWith(
        expect.any(CreateManager),
        expect.objectContaining({ stateSource: '999' }),
        logger,
        disabledArstotzkaConfig
      );
    });

    it('does not run any pipeline automatically at startup, until the api is triggered or a tick fires', async () => {
      const logger = await buildLogger();
      const config = validConfig();
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await shutdown(handlerPromise);

      expect(runPgDumpPipelineMock).not.toHaveBeenCalled();
      expect(runCreatePipelineMock).not.toHaveBeenCalled();
    });

    it('runs the configured target pipeline when a cron tick fires', async () => {
      const logger = await buildLogger();
      const config = validConfig({ 'cli.schedule.target': 'pg_dump' });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await getCapturedCronTick()?.();
      await shutdown(handlerPromise);

      expect(runPgDumpPipelineMock).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduled run finished successfully', target: 'pg_dump' }));
    });

    it('rejects a second concurrent trigger while a run is already in progress, regardless of which trigger it came from', async () => {
      const logger = await buildLogger();
      const config = validConfig({ 'cli.schedule.target': 'pg_dump' });

      let resolveFirstRun: () => void = () => {};
      runPgDumpPipelineMock.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            resolveFirstRun = resolve;
          })
      );

      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);

      const firstRunPromise = getCapturedTriggers()?.runPgDump();
      await expect(getCapturedTriggers()?.runCreate()).rejects.toThrow(RunInProgressError);

      resolveFirstRun();
      await firstRunPromise;
      await shutdown(handlerPromise);
    });
  });

  describe('Bad Path', () => {
    it('fails with the general error exit code, without arming the scheduler, when stateSource is not a valid uri or number', async () => {
      const registerSpy = vi.spyOn(container, 'register');
      const config = validConfig({ 'cli.stateSource': 'not-a-valid-source' });
      const dependencyContainer = await buildDependencyContainer({ config });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
      expect(getTasks().size).toBe(0);
    });

    it('fails with the general error exit code when cli.schedule.target is not configured', async () => {
      const registerSpy = vi.spyOn(container, 'register');
      const config = validConfig({ 'cli.schedule.target': undefined });
      const dependencyContainer = await buildDependencyContainer({ config });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
      expect(getTasks().size).toBe(0);
    });

    it('fails with the general error exit code when cli.schedule.cronExpression is not configured', async () => {
      const registerSpy = vi.spyOn(container, 'register');
      const config = validConfig({ 'cli.schedule.cronExpression': undefined });
      const dependencyContainer = await buildDependencyContainer({ config });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
    });

    it('fails with the general error exit code when cli.schedule.cronExpression is not a valid cron expression', async () => {
      const registerSpy = vi.spyOn(container, 'register');
      const config = validConfig({ 'cli.schedule.cronExpression': 'not a cron expression' });
      const dependencyContainer = await buildDependencyContainer({ config });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      await handler({ _: [], $0: 'planet-dumper' });

      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
      expect(getTasks().size).toBe(0);
    });
  });

  describe('Sad Path', () => {
    it('logs and retries on the next tick, without crashing the scheduler, when s3.bucketName is missing for a create-target tick', async () => {
      const logger = await buildLogger();
      const registerSpy = vi.spyOn(container, 'register');
      const config = validConfig({ 'cli.schedule.target': 'create', 's3.bucketName': undefined });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await getCapturedCronTick()?.();
      await shutdown(handlerPromise);

      expect(runCreatePipelineMock).not.toHaveBeenCalled();
      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduled run failed, will retry on next tick', target: 'create' }));
      expect(registerSpy).not.toHaveBeenCalledWith(EXIT_CODE, expect.anything());
    });

    it('logs and retries on the next tick, without crashing the scheduler, when the pipeline itself throws', async () => {
      const logger = await buildLogger();
      runPgDumpPipelineMock.mockRejectedValueOnce(new Error('pg_dump failed'));
      const config = validConfig();
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
      const handlerPromise = handler({ _: [], $0: 'planet-dumper' });
      await waitForArmed(logger);
      await getCapturedCronTick()?.();
      await shutdown(handlerPromise);

      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduled run failed, will retry on next tick', target: 'pg_dump' }));
    });
  });
});
