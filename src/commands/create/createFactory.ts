import type { CommandModule } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { ExitCodes, EXIT_CODE, SERVICES } from '@common/constants';
import { ErrorWithExitCode, CheckError } from '@common/errors';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';
import { terminateChildren } from '@common/spawner';
import { stateSourceCheck } from '../common/checks';
import { runCreatePipeline, type CreatePipelineArgs } from '../common/pipelineRunner';
import type { CreateManager } from './createManager';
import { CREATE_MANAGER_FACTORY } from './createManagerFactory';

export const CREATE_COMMAND_FACTORY = Symbol('CreateCommandFactory');

export const createCommandFactory: FactoryFunction<CommandModule> = (dependencyContainer) => {
  const command = 'create';

  const describe = 'create a pbf dump from an osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const handler = async (): Promise<void> => {
    logger.debug({ msg: 'starting command execution', command });

    const config = dependencyContainer.resolve<ConfigType>(SERVICES.CONFIG);
    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);

    try {
      const stateSource = config.get('cli.stateSource');
      stateSourceCheck(stateSource);

      const s3BucketName = config.get('s3.bucketName');
      if (s3BucketName === undefined) {
        throw new CheckError('s3.endpoint and s3.bucketName must be configured to run the create command', 's3', { s3BucketName });
      }

      const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);

      const args: CreatePipelineArgs = {
        outputFormat: config.get('cli.outputFormat'),
        stateSource,
        cleanupMode: config.get('cli.cleanupMode'),
        resume: config.get('cli.resume'),
        info: config.get('cli.info'),
        s3BucketName,
        s3Acl: config.get('s3.acl'),
        dumpServerEndpoint: config.get('cli.dumpServer.endpoint'),
        dumpServerHeaders: config.get('cli.dumpServer.headers'),
      };

      await runCreatePipeline(manager, args, logger, arstotzkaConfig);

      logger.info({ msg: 'finished command execution successfully', command, args });
    } catch (error) {
      let exitCode = ExitCodes.GENERAL_ERROR;

      if (error instanceof ErrorWithExitCode) {
        exitCode = error.exitCode;
      }

      terminateChildren();

      container.register(EXIT_CODE, { useValue: exitCode });
      logger.error({ err: error, msg: 'an error occurred while executing command', command: command, exitCode });
    }
  };

  return {
    command,
    describe,
    handler,
  };
};
