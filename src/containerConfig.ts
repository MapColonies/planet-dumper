import { getOtelMixin } from '@map-colonies/tracing-utils';
import { trace } from '@opentelemetry/api';
import type { DependencyContainer } from 'tsyringe/dist/typings/types';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { instancePerContainerCachingFactory } from 'tsyringe';
import axios, { type AxiosInstance } from 'axios';
import { SERVICES, CLI_NAME, CLI_BUILDER, EXIT_CODE, ExitCodes, ON_SIGNAL } from '@common/constants';
import { getConfig, type ConfigType } from '@common/config';
import { getTracing } from '@common/tracing';
import type { InjectionObject } from '@common/dependencyRegistration';
import { registerDependencies } from '@common/dependencyRegistration';
import { cliBuilderFactory } from './cliBuilderFactory';
import { createCommandFactory, CREATE_COMMAND_FACTORY } from './commands/create/createFactory';
import { pgDumpCommandFactory, PG_DUMP_COMMAND_FACTORY } from './commands/pgDump/pgDumpFactory';
import { scheduleCommandFactory, SCHEDULE_COMMAND_FACTORY } from './commands/schedule/scheduleFactory';
import { s3ClientFactory } from './s3client/s3ClientFactory';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useFactory: () => getConfig() } },
      {
        token: SERVICES.LOGGER,
        provider: {
          useFactory: instancePerContainerCachingFactory(async (container) => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            const loggerConfig = config.get('telemetry.logger');
            return jsLogger({ ...loggerConfig, mixin: getOtelMixin() });
          }),
        },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const logger = await deps.resolve<Promise<Logger>>(SERVICES.LOGGER);
          deps.register(SERVICES.LOGGER, { useValue: logger });
        },
      },
      { token: CLI_BUILDER, provider: { useFactory: cliBuilderFactory } },
      { token: PG_DUMP_COMMAND_FACTORY, provider: { useFactory: pgDumpCommandFactory } },
      { token: CREATE_COMMAND_FACTORY, provider: { useFactory: createCommandFactory } },
      { token: SCHEDULE_COMMAND_FACTORY, provider: { useFactory: scheduleCommandFactory } },
      {
        token: SERVICES.CLEANUP_REGISTRY,
        provider: { useValue: cleanupRegistry },
        postInjectionHook(container): void {
          const logger = container.resolve<Logger>(SERVICES.LOGGER);
          const cleanupRegistryLogger = logger.child({ subComponent: 'cleanupRegistry' });

          cleanupRegistry.on('itemFailed', (id, error, msg) => cleanupRegistryLogger.error({ msg, itemId: id, err: error }));
          cleanupRegistry.on('itemCompleted', (id) => cleanupRegistryLogger.info({ itemId: id, msg: 'cleanup finished for item' }));
          cleanupRegistry.on('finished', (status) => cleanupRegistryLogger.info({ msg: `cleanup registry finished cleanup`, status }));
        },
      },
      {
        token: SERVICES.TRACER,
        provider: { useValue: trace.getTracer(CLI_NAME) },
        postInjectionHook(): void {
          cleanupRegistry.register({ id: SERVICES.TRACER, func: getTracing().stop.bind(getTracing()) });
        },
      },
      {
        token: SERVICES.ARSTOTZKA,
        provider: {
          useFactory: (container: DependencyContainer) => container.resolve<ConfigType>(SERVICES.CONFIG).get('arstotzka'),
        },
      },
      {
        token: SERVICES.HTTP_CLIENT,
        provider: {
          useFactory: instancePerContainerCachingFactory((container: DependencyContainer): AxiosInstance => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            return axios.create({ timeout: config.get('httpClient.timeout') });
          }),
        },
      },
      { token: EXIT_CODE, provider: { useValue: ExitCodes.SUCCESS } },
      {
        token: ON_SIGNAL,
        provider: {
          useValue: cleanupRegistry.trigger.bind(cleanupRegistry),
        },
      },
      {
        token: SERVICES.S3,
        provider: { useFactory: instancePerContainerCachingFactory(s3ClientFactory) },
      },
    ];

    const container = await registerDependencies(dependencies, options?.override, options?.useChild);
    return container;
  } catch (error) {
    await cleanupRegistry.trigger();
    throw error;
  }
};
