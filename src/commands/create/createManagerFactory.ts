import { Logger } from '@map-colonies/js-logger';
import { FactoryFunction } from 'tsyringe';
import { CommandRunner } from '../../common/commandRunner';
import { SERVICES } from '../../common/constants';
import { DumpServerClient } from '../../httpClient/dumpClient';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { CreateManager } from './createManager';

export const CREATE_MANAGER_FACTORY = Symbol('CreateManagerFactory');

export const createManagerFactory: FactoryFunction<CreateManager> = (dependencyContainer) => {
  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);
  const s3Client = dependencyContainer.resolve(S3ClientWrapper);
  const dumpClient = dependencyContainer.resolve(DumpServerClient);
  const commandRunner = dependencyContainer.resolve(CommandRunner);
  return new CreateManager(logger, s3Client, dumpClient, commandRunner);
};
