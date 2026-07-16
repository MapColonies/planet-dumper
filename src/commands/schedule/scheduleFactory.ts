import type { Argv, CommandModule, Arguments } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { schedule as cronSchedule } from 'node-cron';
import { S3_REGION, SERVICES } from '@common/constants';
import type { ArstotzkaConfig } from '@common/interfaces';
import { check as checkWrapper } from '@src/wrappers/check';
import { terminateChildren } from '@common/spawner';
import type { GlobalArguments } from '../common/types';
import { CREATE_CLEANUP_CHOICES } from '../common/types';
import { stateSourceCheck } from '../common/checks';
import type { CreateOnlyArguments } from '../common/optionsBuilder';
import { addCleanupModeOption, addCreateOnlyOptions, addOutputAndStateOptions } from '../common/optionsBuilder';
import type { CreatePipelineArgs } from '../common/pipelineRunner';
import { runCreatePipeline, runPgDumpPipeline } from '../common/pipelineRunner';
import { dumpServerUriCheck, httpHeadersCheck } from '../create/checks';
import type { CreateManager } from '../create/createManager';
import { CREATE_MANAGER_FACTORY } from '../create/createManagerFactory';
import type { PgDumpManager } from '../pgDump/pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from '../pgDump/pgDumpManagerFactory';
import { cronExpressionCheck, scheduleTargetOptionsCheck } from './checks';

export const SCHEDULE_COMMAND_FACTORY = Symbol('ScheduleCommandFactory');

export type ScheduleTarget = 'create' | 'pg_dump';

export interface ScheduleArguments extends GlobalArguments, CreateOnlyArguments {
  target: ScheduleTarget;
  cronExpression: string;
  runOnInit: boolean;
}

export const scheduleCommandFactory: FactoryFunction<CommandModule<ScheduleArguments, ScheduleArguments>> = (dependencyContainer) => {
  const command = 'schedule';

  const describe = 'run the create or pg_dump pipeline repeatedly on a cron schedule';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const builder = (yargs: Argv<ScheduleArguments>): Argv<ScheduleArguments> => {
    addCreateOnlyOptions(addCleanupModeOption(addOutputAndStateOptions(yargs), CREATE_CLEANUP_CHOICES))
      .option('target', {
        describe: 'which pipeline to run on each scheduled tick',
        choices: ['create', 'pg_dump'] as ScheduleTarget[],
        nargs: 1,
        type: 'string',
        demandOption: true,
      })
      .option('cronExpression', {
        alias: ['cron-expression'],
        describe: 'a cron expression controlling the schedule',
        nargs: 1,
        type: 'string',
        demandOption: true,
      })
      .option('runOnInit', {
        alias: ['run-on-init'],
        describe: 'immediately run the pipeline once at startup, before waiting for the first scheduled tick',
        type: 'boolean',
        default: false,
      })
      .check(checkWrapper(stateSourceCheck, logger))
      .check(checkWrapper(cronExpressionCheck, logger))
      .check(checkWrapper(scheduleTargetOptionsCheck, logger))
      .check(checkWrapper(dumpServerUriCheck, logger))
      .check(checkWrapper(httpHeadersCheck, logger))
      .middleware((argv) => {
        if (argv.target === 'create') {
          const { s3Endpoint } = argv;
          const client = new S3Client({
            endpoint: s3Endpoint,
            region: S3_REGION,
            forcePathStyle: true,
          });
          container.register(SERVICES.S3, { useValue: client });
        }
      });
    return yargs;
  };

  const handler = async (args: Arguments<ScheduleArguments>): Promise<void> => {
    const { target, cronExpression, runOnInit } = args;

    logger.debug({ msg: 'starting command execution', command, args });

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);

    const runOnce = async (): Promise<void> => {
      try {
        if (target === 'create') {
          // s3Endpoint/s3BucketName are guaranteed defined here by scheduleTargetOptionsCheck
          const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);
          await runCreatePipeline(manager, args as unknown as CreatePipelineArgs, logger, arstotzkaConfig);
        } else {
          const manager = dependencyContainer.resolve<PgDumpManager>(PG_DUMP_MANAGER_FACTORY);
          await runPgDumpPipeline(manager, args, logger, arstotzkaConfig);
        }

        logger.info({ msg: 'scheduled run finished successfully', command, target });
      } catch (error) {
        terminateChildren();
        logger.error({ err: error, msg: 'scheduled run failed, will retry on next tick', command, target });
      }
    };

    if (runOnInit) {
      await runOnce();
    }

    const task = cronSchedule(cronExpression, runOnce, { noOverlap: true, name: 'planet-dumper-schedule' });
    task.on('execution:overlap', () => {
      logger.warn({ msg: 'skipped scheduled tick because the previous run is still in-flight', command, target });
    });

    logger.info({ msg: 'scheduler armed, waiting for ticks', command, cronExpression, target });

    await new Promise<void>((resolve) => {
      const shutdown = (signal: string): void => {
        logger.info({ msg: 'received shutdown signal, stopping scheduler', signal });
        void Promise.resolve(task.stop()).finally(resolve);
      };
      process.once('SIGTERM', () => shutdown('SIGTERM'));
      process.once('SIGINT', () => shutdown('SIGINT'));
    });

    logger.info({ msg: 'schedule command shutting down', command });
  };

  return {
    command,
    describe,
    builder,
    handler,
  };
};
