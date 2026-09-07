import type { DependencyContainer } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { SERVICES, S3_REGION } from '@common/constants';
import type { ConfigType } from '@common/config';
import { s3ConfigCheck } from '@src/commands/common/checks';

export const s3ClientFactory = (container: DependencyContainer): S3Client => {
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  const s3Config = config.get('s3');

  s3ConfigCheck(s3Config);

  return new S3Client({ endpoint: s3Config.endpoint, region: S3_REGION, forcePathStyle: true });
};
