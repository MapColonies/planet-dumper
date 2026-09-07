/* eslint-disable @typescript-eslint/naming-convention */
import { container } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommandFactory } from '@src/commands/create/createFactory';
import { runCreatePipeline } from '@src/commands/common/pipelineRunner';
import { terminateChildren } from '@common/spawner';
import { EXIT_CODE, ExitCodes, SERVICES } from '@common/constants';
import { PgDumpError } from '@common/errors';
import { CreateManager } from '@src/commands/create/createManager';
import { buildConfig, buildCreateManager, buildLogger, disabledArstotzkaConfig } from '@tests/fixtures';

vi.mock('@src/commands/common/pipelineRunner', () => ({
  runCreatePipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@common/spawner', () => ({
  terminateChildren: vi.fn(),
}));

const runCreatePipelineMock = vi.mocked(runCreatePipeline);
const terminateChildrenMock = vi.mocked(terminateChildren);

const buildDependencyContainer = async (overrides: {
  config?: ReturnType<typeof buildConfig>;
  manager?: CreateManager;
  logger?: Logger;
}): Promise<DependencyContainer> => {
  const logger = overrides.logger ?? (await buildLogger());
  const config = overrides.config ?? buildConfig();
  const manager = overrides.manager ?? buildCreateManager(logger, config);

  const dependencyContainer = container.createChildContainer();
  dependencyContainer.register(SERVICES.LOGGER, { useValue: logger });
  dependencyContainer.register(SERVICES.CONFIG, { useValue: config });
  dependencyContainer.register(SERVICES.ARSTOTZKA, { useValue: disabledArstotzkaConfig });
  dependencyContainer.register(CreateManager, { useValue: manager });

  return dependencyContainer;
};

describe('createCommandFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path', () => {
    it('runs the create pipeline with arguments mapped from config and logs success', async () => {
      const logger = await buildLogger();
      const dependencyContainer = await buildDependencyContainer({ config: buildConfig(), logger });
      const { handler } = createCommandFactory(dependencyContainer);

      await handler({ _: [], $0: 'planet-dumper' });

      expect(runCreatePipelineMock).toHaveBeenCalledWith(
        expect.any(CreateManager),
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
      const config = buildConfig({ 'cli.stateSource': 'not-a-valid-source' });
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = await buildDependencyContainer({ config });
      const { handler } = createCommandFactory(dependencyContainer);

      await handler({ _: [], $0: 'planet-dumper' });

      expect(runCreatePipelineMock).not.toHaveBeenCalled();
      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.GENERAL_ERROR });
    });

    it('fails with the general error exit code, without running the pipeline, when s3 endpoint or bucket name is missing', async () => {
      const config = buildConfig({
        's3.endpoint': undefined,
        's3.bucketName': undefined,
      });
      const registerSpy = vi.spyOn(container, 'register');
      const dependencyContainer = await buildDependencyContainer({ config });
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
      const dependencyContainer = await buildDependencyContainer({ config: buildConfig() });
      const { handler } = createCommandFactory(dependencyContainer);

      await handler({ _: [], $0: 'planet-dumper' });

      expect(terminateChildrenMock).toHaveBeenCalledOnce();
      expect(registerSpy).toHaveBeenCalledWith(EXIT_CODE, { useValue: ExitCodes.PG_DUMP_ERROR });
    });
  });
});
