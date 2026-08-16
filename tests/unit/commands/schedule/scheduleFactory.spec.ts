import { container } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { getTasks } from 'node-cron';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleCommandFactory } from '@src/commands/schedule/scheduleFactory';
import { CREATE_MANAGER_FACTORY } from '@src/commands/create/createManagerFactory';
import { PG_DUMP_MANAGER_FACTORY } from '@src/commands/pgDump/pgDumpManagerFactory';
import { runCreatePipeline, runPgDumpPipeline } from '@src/commands/common/pipelineRunner';
import { terminateChildren } from '@common/spawner';
import { EXIT_CODE, ExitCodes, SERVICES } from '@common/constants';
import { CreateManager } from '@src/commands/create/createManager';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { buildConfig, buildCreateManager, buildLogger, buildPgDumpManager, disabledArstotzkaConfig } from '@tests/fixtures';

// a cron expression that only fires once a year, so tests only ever observe the runOnInit tick, not a real one
const NEVER_DURING_TEST_CRON = '0 0 0 1 1 *';

vi.mock('@src/commands/common/pipelineRunner', () => ({
  runCreatePipeline: vi.fn().mockResolvedValue(undefined),
  runPgDumpPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@common/spawner', () => ({
  terminateChildren: vi.fn(),
}));

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
  dependencyContainer.register(CREATE_MANAGER_FACTORY, { useValue: createManager });
  dependencyContainer.register(PG_DUMP_MANAGER_FACTORY, { useValue: pgDumpManager });

  return dependencyContainer;
};

// this file's own cron override (fires once a year), not shared with the rest of the suite
const validConfig = (overrides: Record<string, unknown> = {}): ReturnType<typeof buildConfig> =>
  buildConfig({ 'cli.schedule.cronExpression': NEVER_DURING_TEST_CRON, ...overrides });

const runUntilArmedThenShutdown = async (handler: (args: { _: string[]; $0: string }) => Promise<void>, logger: Logger): Promise<void> => {
  const handlerPromise = handler({ _: [], $0: 'planet-dumper' });

  await vi.waitFor(() => {
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduler armed, waiting for ticks' }));
  });

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
    it('runs the pg_dump pipeline immediately on init when runOnInit is true, then arms and shuts down cleanly', async () => {
      const logger = await buildLogger();
      const config = validConfig({ 'cli.schedule.target': 'pg_dump', 'cli.schedule.runOnInit': true });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      await runUntilArmedThenShutdown(handler, logger);

      expect(runPgDumpPipelineMock).toHaveBeenCalledWith(
        expect.any(PgDumpManager),
        { outputFormat: 'dump_{state}_{timestamp}.pbf', stateSource: '1', cleanupMode: 'none' },
        logger,
        disabledArstotzkaConfig
      );
      expect(runCreatePipelineMock).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduled run finished successfully', target: 'pg_dump' }));
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: 'schedule command shutting down' }));
    });

    it('runs the create pipeline with s3 args when target is create', async () => {
      const logger = await buildLogger();
      const config = validConfig({
        'cli.schedule.target': 'create',
        'cli.schedule.runOnInit': true,
        'cli.resume': false,
        'cli.info': false,
        's3.bucketName': 'bucket',
        's3.acl': 'private',
        'cli.dumpServer.endpoint': undefined,
        'cli.dumpServer.headers': [],
      });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      await runUntilArmedThenShutdown(handler, logger);

      expect(runCreatePipelineMock).toHaveBeenCalledWith(
        expect.any(CreateManager),
        expect.objectContaining({ outputFormat: 'dump_{state}_{timestamp}.pbf', stateSource: '1', s3BucketName: 'bucket', s3Acl: 'private' }),
        logger,
        disabledArstotzkaConfig
      );
      expect(runPgDumpPipelineMock).not.toHaveBeenCalled();
    });

    it('does not run a tick before arming when runOnInit is false', async () => {
      const logger = await buildLogger();
      const config = validConfig({ 'cli.schedule.runOnInit': false });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      await runUntilArmedThenShutdown(handler, logger);

      expect(runPgDumpPipelineMock).not.toHaveBeenCalled();
      expect(runCreatePipelineMock).not.toHaveBeenCalled();
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
      const config = validConfig({ 'cli.schedule.target': 'create', 'cli.schedule.runOnInit': true, 's3.bucketName': undefined });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      await runUntilArmedThenShutdown(handler, logger);

      expect(runCreatePipelineMock).not.toHaveBeenCalled();
      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduled run failed, will retry on next tick', target: 'create' }));
      expect(registerSpy).not.toHaveBeenCalledWith(EXIT_CODE, expect.anything());
    });

    it('logs and retries on the next tick, without crashing the scheduler, when the pipeline itself throws', async () => {
      const logger = await buildLogger();
      runPgDumpPipelineMock.mockRejectedValueOnce(new Error('pg_dump failed'));
      const config = validConfig({ 'cli.schedule.runOnInit': true });
      const dependencyContainer = await buildDependencyContainer({ config, logger });
      const { handler } = scheduleCommandFactory(dependencyContainer);

      await runUntilArmedThenShutdown(handler, logger);

      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'scheduled run failed, will retry on next tick', target: 'pg_dump' }));
    });
  });
});
