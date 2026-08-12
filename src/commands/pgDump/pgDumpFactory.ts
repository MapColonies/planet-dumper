import type { CommandModule } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { ExitCodes, EXIT_CODE, SERVICES } from '@common/constants';
import { ErrorWithExitCode } from '@common/errors';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';
import { terminateChildren } from '@common/spawner';
import { stateSourceCheck } from '../common/checks';
import { runPgDumpPipeline, type PgDumpPipelineArgs } from '../common/pipelineRunner';
import type { PgDumpManager } from './pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from './pgDumpManagerFactory';

export const PG_DUMP_COMMAND_FACTORY = Symbol('PgDumpCommandFactory');

export const pgDumpCommandFactory: FactoryFunction<CommandModule> = (dependencyContainer) => {
  const command = 'pg_dump';

  const describe = 'create a postgres dump from an existing osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const handler = async (): Promise<void> => {
    logger.debug({ msg: 'starting command execution', command });

    const config = dependencyContainer.resolve<ConfigType>(SERVICES.CONFIG);
    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    const manager = dependencyContainer.resolve<PgDumpManager>(PG_DUMP_MANAGER_FACTORY);

    try {
      const stateSource = config.get('cli.stateSource');
      stateSourceCheck(stateSource);

      const args: PgDumpPipelineArgs = {
        outputFormat: config.get('cli.outputFormat'),
        stateSource,
        cleanupMode: config.get('cli.cleanupMode'),
      };

      await runPgDumpPipeline(manager, args, logger, arstotzkaConfig);

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
