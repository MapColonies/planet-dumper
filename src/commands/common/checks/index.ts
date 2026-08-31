import { isWebUri } from 'valid-url';
import type { vectorPlanetDumperV1Type } from '@map-colonies/schemas';
import { CheckError } from '@common/errors';
import type { CheckFunc } from '@src/wrappers/check';

const STATE_SOURCE_CHECK_ARG = 'cli.stateSource';
const S3_CHECK_ARG = 's3';

type S3Config = vectorPlanetDumperV1Type['s3'];
type ConfiguredS3Config = S3Config & { endpoint: string; bucketName: string };

export const stateSourceCheck: CheckFunc<string> = (stateSource) => {
  if (isNaN(parseInt(stateSource)) && isWebUri(stateSource) === undefined) {
    throw new CheckError(`${STATE_SOURCE_CHECK_ARG} is not a valid web uri`, STATE_SOURCE_CHECK_ARG, stateSource);
  }
  return true;
};

export function s3ConfigCheck(s3Config: S3Config): asserts s3Config is ConfiguredS3Config {
  const { endpoint, bucketName } = s3Config;
  if (endpoint === undefined || endpoint === '' || bucketName === undefined || bucketName === '') {
    throw new CheckError(`${S3_CHECK_ARG}.endpoint and ${S3_CHECK_ARG}.bucketName must be configured`, S3_CHECK_ARG, { endpoint, bucketName });
  }
}
