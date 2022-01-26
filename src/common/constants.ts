/* eslint-disable @typescript-eslint/naming-convention */
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
  TERMINATED: 130,
};

export const S3_REGION = 'us-east-1';
export const S3_NOT_FOUND_ERROR_NAME = 'NotFound';
export const PG_DUMPS_PATH = '/tmp';
export const NG_DUMPS_PATH = '/tmp';
export const PBF_FILE_FORMAT = 'pbf';
export const PG_DUMP_FILE_FORMAT = 'dmp';
