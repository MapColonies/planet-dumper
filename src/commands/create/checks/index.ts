import { isWebUri } from 'valid-url';
import { CheckError } from '../../../common/errors';
import { CheckFunc } from '../../../wrappers/check';
import { CreateArguments } from '../create';

const DUMP_SERVER_URI_CHECK_ARG = 'dump-server-endpoint';
const HTTP_HEADERS_CHECK_ARG = 'dump-server-headers';

const HEADER_KEY_VALUE_PAIR_LENGTH = 2;

export const dumpServerUriCheck: CheckFunc<CreateArguments> = (argv) => {
  const { dumpServerEndpoint } = argv;
  if (dumpServerEndpoint !== undefined && isWebUri(dumpServerEndpoint) === undefined) {
    throw new CheckError(`${DUMP_SERVER_URI_CHECK_ARG} is not a valid web uri`, DUMP_SERVER_URI_CHECK_ARG, dumpServerEndpoint);
  }
  return true;
};

export const httpHeadersCheck: CheckFunc<CreateArguments> = (argv) => {
  const { dumpServerHeaders } = argv;
  if (dumpServerHeaders.length > 0) {
    if (dumpServerHeaders.some((headerKeyValue) => headerKeyValue.trim().split('=').length !== HEADER_KEY_VALUE_PAIR_LENGTH)) {
      throw new CheckError(`${HTTP_HEADERS_CHECK_ARG} must be provided in a key=value format`, HTTP_HEADERS_CHECK_ARG, dumpServerHeaders);
    }
  }
  return true;
};
