import { Logger } from '@map-colonies/js-logger';
import { AxiosInstance } from 'axios';
import { FactoryFunction } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { IConfig } from '../../common/interfaces';
import { PgDumpManager } from './pgDumpManager';

export const PG_DUMP_MANAGER_FACTORY = Symbol('PgDumpManagerFactory');

export const pgDumpManagerFactory: FactoryFunction<PgDumpManager> = (dependencyContainer) => {
  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);
  const config = dependencyContainer.resolve<IConfig>(SERVICES.CONFIG);
  const axios = dependencyContainer.resolve<AxiosInstance>(SERVICES.HTTP_CLIENT);
  return new PgDumpManager(logger, config, axios);
};
