import { isWebUri } from 'valid-url';
import { CheckError } from '@common/errors';
import type { CheckFunc } from '@src/wrappers/check';

const STATE_SOURCE_CHECK_ARG = 'cli.stateSource';

export const stateSourceCheck: CheckFunc<string> = (stateSource) => {
  if (isNaN(parseInt(stateSource)) && isWebUri(stateSource) === undefined) {
    throw new CheckError(`${STATE_SOURCE_CHECK_ARG} is not a valid web uri`, STATE_SOURCE_CHECK_ARG, stateSource);
  }
  return true;
};
