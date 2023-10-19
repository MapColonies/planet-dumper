import { Logger } from '@map-colonies/js-logger';
import { FactoryFunction } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { IConfig } from '../../common/interfaces';
import { DumpServerClient } from '../../httpClient/dumpClient';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { CreateManager } from './createManager';

export const CREATE_MANAGER_FACTORY = Symbol('CreateManagerFactory');

export const createManagerFactory: FactoryFunction<CreateManager> = (dependencyContainer) => {
  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);
  const s3Client = dependencyContainer.resolve(S3ClientWrapper);
  const dumpClient = dependencyContainer.resolve(DumpServerClient);
  const config = dependencyContainer.resolve<IConfig>(SERVICES.CONFIG);
  return new CreateManager(logger, config, dumpClient, s3Client);
};
