import { Argv, CommandModule, Arguments } from 'yargs';
import { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { container, FactoryFunction } from 'tsyringe';
import { DEFAULT_STATE, ExitCodes, EXIT_CODE, SERVICES } from '../../common/constants';
import { ErrorWithExitCode } from '../../common/errors';
import { ArstotzkaConfig } from '../../common/interfaces';
import { check as checkWrapper } from '../../wrappers/check';
import { CleanupMode, GlobalArguments as PgDumpArguments } from '../common/types';
import { stateSourceCheck } from '../common/checks';
import { terminateChildren } from '../../processes/spawner';
import { PgDumpManager } from './pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from './pgDumpManagerFactory';

export const PG_DUMP_COMMAND_FACTORY = Symbol('PgDumpCommandFactory');

export const pgDumpCommandFactory: FactoryFunction<CommandModule<PgDumpArguments, PgDumpArguments>> = (dependencyContainer) => {
  const command = 'pg_dump';

  const describe = 'create a postgres dump from an existing osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const builder = (yargs: Argv<PgDumpArguments>): Argv<PgDumpArguments> => {
    yargs
      .option('outputFormat', {
        alias: ['o', 'output-format'],
        description: 'The resulting output name format, example: prefix_{sequenceNumber}_{timestamp}_suffix.pbf',
        nargs: 1,
        type: 'string',
        demandOption: true,
      })
      .option('stateSource', {
        alias: ['s'],
        description: 'Determines state seqeunce number to source',
        nargs: 1,
        type: 'string',
        default: DEFAULT_STATE.toString(),
      })
      .option('cleanupMode', {
        alias: 'c',
        describe: 'the command execution cleanup mode',
        choices: ['none', 'pre-clean-others', 'post-clean-others'] as CleanupMode[],
        nargs: 1,
        type: 'string',
        default: 'none' as CleanupMode,
      })
      .check(checkWrapper(stateSourceCheck, logger));
    return yargs;
  };

  const handler = async (args: Arguments<PgDumpArguments>): Promise<void> => {
    const { outputFormat, stateSource, cleanupMode } = args;

    logger.debug({ msg: 'starting command execution', command, args });

    let pgMediator: StatefulMediator | undefined;

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    if (arstotzkaConfig.enabled) {
      pgMediator = new StatefulMediator({ ...arstotzkaConfig.mediator, serviceId: arstotzkaConfig.services['planetDumperPg'], logger });
    }

    const manager = dependencyContainer.resolve<PgDumpManager>(PG_DUMP_MANAGER_FACTORY);

    try {
      await manager.createPgDump(outputFormat, stateSource, cleanupMode, pgMediator);

      logger.info({ msg: 'finished command execution successfully', command, args });
    } catch (error) {
      let exitCode = ExitCodes.GENERAL_ERROR;

      if (error instanceof ErrorWithExitCode) {
        exitCode = error.exitCode;
      }

      terminateChildren();
      await pgMediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });

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
