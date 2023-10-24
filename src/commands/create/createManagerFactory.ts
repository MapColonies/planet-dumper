import { Logger } from '@map-colonies/js-logger';
import { AxiosInstance } from 'axios';
import { FactoryFunction } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { IConfig } from '../../common/interfaces';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { CreateManager } from './createManager';

export const CREATE_MANAGER_FACTORY = Symbol('CreateManagerFactory');

export const createManagerFactory: FactoryFunction<CreateManager> = (dependencyContainer) => {
  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);
  const config = dependencyContainer.resolve<IConfig>(SERVICES.CONFIG);
  const axios = dependencyContainer.resolve<AxiosInstance>(SERVICES.HTTP_CLIENT);
  const s3Client = dependencyContainer.resolve(S3ClientWrapper);
  return new CreateManager(logger, config, axios, s3Client);
};
