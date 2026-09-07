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
import { httpServerFactory, RunInProgressError } from '@src/httpServer/httpServerFactory';
import { s3ConfigCheck, stateSourceCheck } from '../common/checks';
import type { CreatePipelineArgs, PgDumpPipelineArgs } from '../common/pipelineRunner';
import { runCreatePipeline, runPgDumpPipeline } from '../common/pipelineRunner';
import { CreateManager } from '../create/createManager';
import { PgDumpManager } from '../pgDump/pgDumpManager';
import { cronExpressionCheck } from './checks';

const DEFAULT_HTTP_SERVER_PORT = 8080;

export const SCHEDULE_COMMAND_FACTORY = Symbol('ScheduleCommandFactory');

export const scheduleCommandFactory: FactoryFunction<CommandModule> = (dependencyContainer) => {
  const command = 'schedule';

  const describe = 'run the create or pg_dump pipeline repeatedly on a cron schedule, and on demand via an http trigger';

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

      const outputFormat = config.get('cli.outputFormat');
      const cleanupMode = config.get('cli.cleanupMode');

      const runPipeline = async (runTarget: 'create' | 'pg_dump', stateSourceOverride?: string): Promise<void> => {
        const effectiveStateSource = stateSourceOverride ?? stateSource;

        if (runTarget === 'create') {
          const s3Config = config.get('s3');
          s3ConfigCheck(s3Config);

          const args: CreatePipelineArgs = {
            outputFormat,
            stateSource: effectiveStateSource,
            cleanupMode,
            resume: config.get('cli.resume'),
            info: config.get('cli.info'),
            s3BucketName: s3Config.bucketName,
            s3Acl: s3Config.acl,
            dumpServerEndpoint: config.get('cli.dumpServer.endpoint'),
            dumpServerHeaders: config.get('cli.dumpServer.headers'),
          };
          const manager = dependencyContainer.resolve(CreateManager);
          await runCreatePipeline(manager, args, logger, arstotzkaConfig);
        } else {
          const args: PgDumpPipelineArgs = { outputFormat, stateSource: effectiveStateSource, cleanupMode };
          const manager = dependencyContainer.resolve(PgDumpManager);
          await runPgDumpPipeline(manager, args, logger, arstotzkaConfig);
        }
      };

      let isRunInProgress = false;

      const guardedRunPipeline = async (runTarget: 'create' | 'pg_dump', stateSourceOverride?: string): Promise<void> => {
        if (isRunInProgress) {
          throw new RunInProgressError('a run is already in progress');
        }
        isRunInProgress = true;
        try {
          await runPipeline(runTarget, stateSourceOverride);
        } finally {
          isRunInProgress = false;
        }
      };

      const cronTick = async (): Promise<void> => {
        try {
          await guardedRunPipeline(target);
          logger.info({ msg: 'scheduled run finished successfully', command, target });
        } catch (error) {
          if (!(error instanceof RunInProgressError)) {
            terminateChildren();
            logger.error({ err: error, msg: 'scheduled run failed, will retry on next tick', command, target });
          }
        }
      };

      const task = cronSchedule(cronExpression, cronTick, { noOverlap: true, name: 'planet-dumper-schedule' });
      task.on('execution:overlap', () => {
        logger.warn({ msg: 'skipped scheduled tick because the previous run is still in-flight', command, target });
      });

      const httpServerPort = Number(process.env.HTTP_SERVER_PORT ?? DEFAULT_HTTP_SERVER_PORT);
      const httpServer = httpServerFactory(logger, {
        runPgDump: async () => guardedRunPipeline('pg_dump'),
        runCreate: async (stateSourceOverride) => guardedRunPipeline('create', stateSourceOverride),
      }).listen(httpServerPort, () => {
        logger.info({ msg: 'http trigger server listening', port: httpServerPort });
      });

      logger.info({ msg: 'scheduler armed, waiting for ticks', command, cronExpression, target });

      await new Promise<void>((resolve) => {
        const shutdown = (signal: string): void => {
          logger.info({ msg: 'received shutdown signal, stopping scheduler', signal });
          void Promise.all([Promise.resolve(task.stop()), new Promise<void>((res) => httpServer.close(() => res()))]).finally(resolve);
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
