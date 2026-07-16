import type { Logger } from '@map-colonies/js-logger';
import type { AxiosInstance } from 'axios';
import type { FactoryFunction } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { PgDumpManager } from './pgDumpManager';

export const PG_DUMP_MANAGER_FACTORY = Symbol('PgDumpManagerFactory');

export const pgDumpManagerFactory: FactoryFunction<PgDumpManager> = (dependencyContainer) => {
  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);
  const config = dependencyContainer.resolve<ConfigType>(SERVICES.CONFIG);
  const axios = dependencyContainer.resolve<AxiosInstance>(SERVICES.HTTP_CLIENT);
  return new PgDumpManager(logger, config, axios);
};
