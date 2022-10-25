import { isWebUri } from 'valid-url';
import { Arguments } from 'yargs';
import { CheckError } from '../../../common/errors';
import { CreateArguments } from '../create';

const HEADER_KEY_VALUE_PAIR_LENGTH = 2;

export type CheckFunc<T> = (argv: Arguments<T>) => boolean;

export const stateArgsCheck: CheckFunc<CreateArguments> = (argv) => {
  const { includeState, stateBucketName } = argv;
  if (includeState && stateBucketName === undefined) {
    const argument = 'state-bucket-name';
    throw new CheckError(`${argument} is required when include-state is true`, argument, stateBucketName);
  }
  return true;
};

export const dumpServerUriCheck: CheckFunc<CreateArguments> = (argv) => {
  const { dumpServerEndpoint } = argv;
  if (dumpServerEndpoint !== undefined && isWebUri(dumpServerEndpoint) === undefined) {
    const argument = 'dump-server-endpoint';
    throw new CheckError(`${argument} is not a valid web uri`, argument, dumpServerEndpoint);
  }
  return true;
};

export const headersCheck: CheckFunc<CreateArguments> = (argv) => {
  const { dumpServerHeaders } = argv;
  if (dumpServerHeaders.length > 0) {
    if (dumpServerHeaders.some((headerKeyValue) => headerKeyValue.trim().split('=').length !== HEADER_KEY_VALUE_PAIR_LENGTH)) {
      const argument = 'dump-server-headers';
      throw new CheckError(`${argument} must be provided in a key=value format`, argument, dumpServerHeaders);
    }
  }
  return true;
};
