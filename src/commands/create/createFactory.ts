import type { CommandModule } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { ExitCodes, EXIT_CODE, SERVICES } from '@common/constants';
import { ErrorWithExitCode } from '@common/errors';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';
import { terminateChildren } from '@common/spawner';
import { s3ConfigCheck, stateSourceCheck } from '../common/checks';
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

      const s3Config = config.get('s3');
      s3ConfigCheck(s3Config);

      const manager = dependencyContainer.resolve(CreateManager);

      const { outputFormat, cleanupMode, resume, info, dumpServer } = config.get('cli');

      const args: CreatePipelineArgs = {
        outputFormat,
        stateSource,
        cleanupMode,
        resume,
        info,
        s3BucketName: s3Config.bucketName,
        s3Acl: s3Config.acl,
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
