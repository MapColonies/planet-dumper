import config from 'config';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import axios from 'axios';
import { SERVICES, CLI_NAME, CLI_BUILDER, EXIT_CODE, ExitCodes, ON_SIGNAL } from './common/constants';
import { tracing } from './common/tracing';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { cliBuilderFactory } from './cliBuilderFactory';
import { createCommandFactory, CREATE_COMMAND_FACTORY } from './commands/create/createFactory';
import { createManagerFactory, CREATE_MANAGER_FACTORY } from './commands/create/createManagerFactory';
import { ArstotzkaConfig } from './common/interfaces';
import { pgDumpCommandFactory, PG_DUMP_COMMAND_FACTORY } from './commands/pgDump/pgDumpFactory';
import { pgDumpManagerFactory, PG_DUMP_MANAGER_FACTORY } from './commands/pgDump/pgDumpManagerFactory';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
    const logger = jsLogger({ ...loggerConfig, mixin: getOtelMixin() });

    const arstotzkaConfig = config.get<ArstotzkaConfig>('arstotzka');

    const axiosClient = axios.create({ timeout: config.get('httpClient.timeout') });

    cleanupRegistry.on('itemFailed', (id, error, msg) => logger.error({ msg, itemId: id, err: error }));
    cleanupRegistry.on('finished', (status) => logger.info({ msg: `cleanup registry finished cleanup`, status }));

    cleanupRegistry.register({ func: tracing.stop.bind(tracing), id: SERVICES.TRACER });

    const tracer = trace.getTracer(CLI_NAME);

    const dependencies: InjectionObject<unknown>[] = [
      { token: CLI_BUILDER, provider: { useFactory: cliBuilderFactory } },
      { token: PG_DUMP_COMMAND_FACTORY, provider: { useFactory: pgDumpCommandFactory } },
      { token: CREATE_COMMAND_FACTORY, provider: { useFactory: createCommandFactory } },
      { token: PG_DUMP_MANAGER_FACTORY, provider: { useFactory: pgDumpManagerFactory } },
      { token: CREATE_MANAGER_FACTORY, provider: { useFactory: createManagerFactory } },
      { token: SERVICES.CONFIG, provider: { useValue: config } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      { token: SERVICES.ARSTOTZKA, provider: { useValue: arstotzkaConfig } },
      { token: SERVICES.HTTP_CLIENT, provider: { useValue: axiosClient } },
      { token: EXIT_CODE, provider: { useValue: ExitCodes.SUCCESS } },
      {
        token: ON_SIGNAL,
        provider: {
          useValue: cleanupRegistry.trigger.bind(cleanupRegistry),
        },
      },
    ];

    return registerDependencies(dependencies, options?.override, options?.useChild);
  } catch (error) {
    await cleanupRegistry.trigger();
    throw error;
  }
};
