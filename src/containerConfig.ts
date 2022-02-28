import config from 'config';
import { logMethod } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import axios from 'axios';
import { ON_SIGNAL, SERVICES, CLI_NAME, CLI_BUILDER, EXIT_CODE, ExitCodes } from './common/constants';
import { tracing } from './common/tracing';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { cliBuilderFactory } from './cliBuilderFactory';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = (options?: RegisterOptions): DependencyContainer => {
  const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
  // @ts-expect-error the signature is wrong
  const logger = jsLogger({ ...loggerConfig, hooks: { logMethod } });

  const axiosClient = axios.create({ timeout: config.get('httpClient.timeout') });

  tracing.start();
  const tracer = trace.getTracer(CLI_NAME);

  const dependencies: InjectionObject<unknown>[] = [
    { token: CLI_BUILDER, provider: { useFactory: cliBuilderFactory } },
    { token: SERVICES.CONFIG, provider: { useValue: config } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    { token: SERVICES.HTTP_CLIENT, provider: { useValue: axiosClient } },
    {
      token: ON_SIGNAL,
      provider: {
        useValue: async (): Promise<void> => {
          await Promise.all([tracing.stop()]);
        },
      },
    },
    { token: EXIT_CODE, provider: { useValue: ExitCodes.SUCCESS } },
  ];

  return registerDependencies(dependencies, options?.override, options?.useChild);
};
