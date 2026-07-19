import type { Argv, CommandModule, Arguments } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { ExitCodes, EXIT_CODE, S3_REGION, SERVICES } from '@common/constants';
import { ErrorWithExitCode } from '@common/errors';
import { check as checkWrapper } from '@src/wrappers/check';
import type { ArstotzkaConfig, DumpServerConfig, S3Config } from '@common/interfaces';
import { terminateChildren } from '@common/spawner';
import type { GlobalArguments } from '../common/types';
import { CREATE_CLEANUP_CHOICES } from '../common/types';
import { stateSourceCheck } from '../common/checks';
import { addCleanupModeOption, addCreateOnlyOptions, addOutputAndStateOptions } from '../common/optionsBuilder';
import { runCreatePipeline } from '../common/pipelineRunner';
import type { CreateManager } from './createManager';
import { httpHeadersCheck, dumpServerUriCheck } from './checks';
import { CREATE_MANAGER_FACTORY } from './createManagerFactory';

export const CREATE_COMMAND_FACTORY = Symbol('CreateCommandFactory');

export interface CreateArguments extends GlobalArguments, S3Config, DumpServerConfig {
  resume: boolean;
  info: boolean;
}

export const createCommandFactory: FactoryFunction<CommandModule<CreateArguments, CreateArguments>> = (dependencyContainer) => {
  const command = 'create';

  const describe = 'create a pbf dump from an osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const builder = (yargs: Argv<CreateArguments>): Argv<CreateArguments> => {
    addCreateOnlyOptions(addCleanupModeOption(addOutputAndStateOptions(yargs), CREATE_CLEANUP_CHOICES))
      .demandOption(['s3Endpoint', 's3BucketName'])
      .check(checkWrapper(stateSourceCheck, logger))
      .check(checkWrapper(dumpServerUriCheck, logger))
      .check(checkWrapper(httpHeadersCheck, logger))
      .middleware((argv) => {
        const { s3Endpoint } = argv;
        const client = new S3Client({
          endpoint: s3Endpoint,
          region: S3_REGION,
          forcePathStyle: true,
        });
        container.register(SERVICES.S3, { useValue: client });
      });
    return yargs;
  };

  const handler = async (args: Arguments<CreateArguments>): Promise<void> => {
    logger.debug({ msg: 'starting command execution', command, args });

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);

    try {
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
    builder,
    handler,
  };
};
