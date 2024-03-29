/* eslint-disable @typescript-eslint/naming-convention */
import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const CLI_NAME = readPackageJsonSync().name ?? 'unknown_cli';

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

export const CLI_BUILDER = Symbol('cliBuilder');
export const EXIT_CODE = Symbol('exitCode');
export const ON_SIGNAL = Symbol('onSignal');

export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  S3: Symbol('S3'),
  HTTP_CLIENT: Symbol('HttpClient'),
  ARSTOTZKA: Symbol('Arstotzka'),
};

export const ExitCodes = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  PG_DUMP_ERROR: 100,
  PLANET_DUMP_NG_ERROR: 101,
  S3_ERROR: 102,
  BUCKET_DOES_NOT_EXIST_ERROR: 103,
  OBJECT_KEY_ALREADY_EXIST_ERROR: 104,
  REMOTE_SERVICE_RESPONSE_ERROR: 105,
  REMOTE_SERVICE_UNAVAILABLE: 106,
  INVALID_STATE_FILE_ERROR: 107,
  OSMIUM_ERROR: 108,
};

export const NOT_FOUND_INDEX = -1;
export const S3_REGION = 'us-east-1';
export const S3_NOT_FOUND_ERROR_NAME = 'NotFound';
export const PG_DUMPS_PATH = '/tmp';
export const NG_DUMPS_PATH = '/tmp';
export const WORKDIR = '/workdir';
export const PG_DUMP_DIR = 'pg_dump';
export const NG_DUMP_DIR = 'ng_dump';
export const PBF_FILE_FORMAT = 'pbf';
export const PG_DUMP_FILE_FORMAT = 'dmp';
export const STATE_FILE_NAME = 'state.txt';
export const EMPTY_STRING = '';
export const SEQUENCE_NUMBER_REGEX = /sequenceNumber=\d+/;
export const DEFAULT_STATE = 1;
