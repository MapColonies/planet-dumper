import { isWebUri } from 'valid-url';
import { CheckError } from '../../../common/errors';
import { CheckFunc } from '../../../wrappers/check';
import { GlobalArguments } from '../types';

const STATE_SOURCE_CHECK_ARG = 'state-source';

export const stateSourceCheck: CheckFunc<GlobalArguments> = (argv) => {
  const { stateSource } = argv;
  if (isNaN(parseInt(stateSource)) && isWebUri(stateSource) === undefined) {
    throw new CheckError(`${STATE_SOURCE_CHECK_ARG} is not a valid web uri`, STATE_SOURCE_CHECK_ARG, stateSource);
  }
  return true;
};
