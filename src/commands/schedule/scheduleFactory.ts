import type { CommandModule } from 'yargs';
import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { container } from 'tsyringe';
import { schedule as cronSchedule } from 'node-cron';
import { ExitCodes, EXIT_CODE, SERVICES } from '@common/constants';
import { ErrorWithExitCode, CheckError } from '@common/errors';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';
import { terminateChildren } from '@common/spawner';
import { stateSourceCheck } from '../common/checks';
import type { CreatePipelineArgs, PgDumpPipelineArgs } from '../common/pipelineRunner';
import { runCreatePipeline, runPgDumpPipeline } from '../common/pipelineRunner';
import type { CreateManager } from '../create/createManager';
import { CREATE_MANAGER_FACTORY } from '../create/createManagerFactory';
import type { PgDumpManager } from '../pgDump/pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from '../pgDump/pgDumpManagerFactory';
import { cronExpressionCheck } from './checks';

export const SCHEDULE_COMMAND_FACTORY = Symbol('ScheduleCommandFactory');

export const scheduleCommandFactory: FactoryFunction<CommandModule> = (dependencyContainer) => {
  const command = 'schedule';

  const describe = 'run the create or pg_dump pipeline repeatedly on a cron schedule';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const handler = async (): Promise<void> => {
    logger.debug({ msg: 'starting command execution', command });

    const config = dependencyContainer.resolve<ConfigType>(SERVICES.CONFIG);
    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);

    try {
      const stateSource = config.get('cli.stateSource');
      stateSourceCheck(stateSource);

      const target = config.get('cli.schedule.target');
      const cronExpression = config.get('cli.schedule.cronExpression');
      if (target === undefined || cronExpression === undefined) {
        throw new CheckError('cli.schedule.target and cli.schedule.cronExpression must be configured to run the schedule command', 'cli.schedule', {
          target,
          cronExpression,
        });
      }
      cronExpressionCheck(cronExpression);

      const runOnInit = config.get('cli.schedule.runOnInit');
      const outputFormat = config.get('cli.outputFormat');
      const cleanupMode = config.get('cli.cleanupMode');

      const runOnce = async (): Promise<void> => {
        try {
          if (target === 'create') {
            const s3BucketName = config.get('s3.bucketName');
            if (s3BucketName === undefined) {
              throw new CheckError('s3.bucketName must be configured when target is "create"', 's3.bucketName', s3BucketName);
            }

            const args: CreatePipelineArgs = {
              outputFormat,
              stateSource,
              cleanupMode,
              resume: config.get('cli.resume'),
              info: config.get('cli.info'),
              s3BucketName,
              s3Acl: config.get('s3.acl'),
              dumpServerEndpoint: config.get('cli.dumpServer.endpoint'),
              dumpServerHeaders: config.get('cli.dumpServer.headers'),
            };
            const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);
            await runCreatePipeline(manager, args, logger, arstotzkaConfig);
          } else {
            const args: PgDumpPipelineArgs = { outputFormat, stateSource, cleanupMode };
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
