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
import { CreateManager } from './createManager';

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
      const s3Endpoint = config.get('s3.endpoint');
      if (s3BucketName === undefined || s3BucketName === '' || s3Endpoint === undefined || s3Endpoint === '') {
        throw new CheckError('s3.endpoint and s3.bucketName must be configured to run the create command', 's3', { s3BucketName, s3Endpoint });
      }

      const manager = dependencyContainer.resolve(CreateManager);

      const { outputFormat, cleanupMode, resume, info, dumpServer } = config.get('cli');

      const args: CreatePipelineArgs = {
        outputFormat,
        stateSource,
        cleanupMode,
        resume,
        info,
        s3BucketName,
        s3Acl: config.get('s3.acl'),
        dumpServerEndpoint: dumpServer.endpoint,
        dumpServerHeaders: dumpServer.headers,
      };

      logger.debug({ msg: 'running create pipeline', args });
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
