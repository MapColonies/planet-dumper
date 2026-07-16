import type { Argv, CommandModule, Arguments } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { ExitCodes, EXIT_CODE, SERVICES } from '@common/constants';
import { ErrorWithExitCode } from '@common/errors';
import type { ArstotzkaConfig } from '@common/interfaces';
import { check as checkWrapper } from '@src/wrappers/check';
import { terminateChildren } from '@common/spawner';
import type { GlobalArguments as PgDumpArguments } from '../common/types';
import { PG_DUMP_CLEANUP_CHOICES } from '../common/types';
import { stateSourceCheck } from '../common/checks';
import { addCleanupModeOption, addOutputAndStateOptions } from '../common/optionsBuilder';
import { runPgDumpPipeline } from '../common/pipelineRunner';
import type { PgDumpManager } from './pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from './pgDumpManagerFactory';

export const PG_DUMP_COMMAND_FACTORY = Symbol('PgDumpCommandFactory');

export const pgDumpCommandFactory: FactoryFunction<CommandModule<PgDumpArguments, PgDumpArguments>> = (dependencyContainer) => {
  const command = 'pg_dump';

  const describe = 'create a postgres dump from an existing osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const builder = (yargs: Argv<PgDumpArguments>): Argv<PgDumpArguments> => {
    addCleanupModeOption(addOutputAndStateOptions(yargs), PG_DUMP_CLEANUP_CHOICES).check(checkWrapper(stateSourceCheck, logger));
    return yargs;
  };

  const handler = async (args: Arguments<PgDumpArguments>): Promise<void> => {
    logger.debug({ msg: 'starting command execution', command, args });

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    const manager = dependencyContainer.resolve<PgDumpManager>(PG_DUMP_MANAGER_FACTORY);

    try {
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
    builder,
    handler,
  };
};
