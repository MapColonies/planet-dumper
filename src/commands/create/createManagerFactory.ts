import type { Logger } from '@map-colonies/js-logger';
import type { AxiosInstance } from 'axios';
import type { FactoryFunction } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { S3ClientWrapper } from '@src/s3client/s3Client';
import { CreateManager } from './createManager';

export const CREATE_MANAGER_FACTORY = Symbol('CreateManagerFactory');

export const createManagerFactory: FactoryFunction<CreateManager> = (dependencyContainer) => {
  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);
  const config = dependencyContainer.resolve<ConfigType>(SERVICES.CONFIG);
  const axios = dependencyContainer.resolve<AxiosInstance>(SERVICES.HTTP_CLIENT);
  const s3Client = dependencyContainer.resolve(S3ClientWrapper);
  return new CreateManager(logger, config, axios, s3Client);
};
