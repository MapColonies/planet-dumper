import path from 'path';
import fs from 'fs';
import config from 'config';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { PBF_FILE_FORMAT, NG_DUMPS_PATH, PG_DUMPS_PATH, ExitCodes, PG_DUMP_FILE_FORMAT } from './common/constants';
import { AppConfig, DumpMetadata } from './common/interfaces';
import { CommandRunner } from './common/commandRunner';
import { S3ClientWrapper } from './s3client/s3Client';
import { BucketDoesNotExistError, ErrorWithExitCode, ObjectKeyAlreadyExistError, PgDumpError, PlanetDumpNgError } from './common/errors';
import { Executable } from './common/types';
import { DumpClient } from './httpClient/dumpClient';

const loggerConfig = config.get<LoggerOptions>('logger');
const logger = jsLogger(loggerConfig);

const commandRunner = new CommandRunner(logger, config);
const appConfig = config.get<AppConfig>('app');

let s3Client: S3ClientWrapper | undefined;
let jobExitCode = ExitCodes.SUCCESS;

process.on('SIGINT', (): void => {
  processExitSafely(ExitCodes.TERMINATED);
});

const buildDumpMetadata = (): DumpMetadata => {
  const {
    addTimestamp,
    dumpPrefix: { enabled: prefixEnabled, value: prefixValue },
    value,
  } = appConfig.dumpName;

  let name = prefixEnabled ? `${prefixValue as string}_${value}` : value;

  const currentTimestamp = new Date();
  if (addTimestamp) {
    name += `_${currentTimestamp.toISOString()}`;
  }

  let bucket: string | undefined;
  if (config.has('s3.bucketName')) {
    bucket = config.get('s3.bucketName');
  }

  return {
    name: `${name}.${PBF_FILE_FORMAT}`,
    bucket,
    timestamp: currentTimestamp,
  };
};

const createPgDump = async (dumpTableName: string): Promise<string> => {
  logger.info('creating pg dump');

  const executable: Executable = 'pg_dump';
  const pgDumpOutputPath = path.join(PG_DUMPS_PATH, dumpTableName);
  const args = ['--format=custom', `--file=${pgDumpOutputPath}`];

  const { exitCode } = await commandRunner.run(executable, undefined, args);

  if (exitCode !== 0) {
    logger.error(`${executable} exit with code ${exitCode as number}`);
    throw new PgDumpError(`an error occurred while running ${executable}, exit code ${exitCode as number}`);
  }

  return pgDumpOutputPath;
};

const createNgDump = async (pgDumpFilePath: string, ngDumpName: string): Promise<string> => {
  logger.info('creating ng dump');

  const executable: Executable = 'planet-dump-ng';
  const ngDumpOutputPath = path.join(NG_DUMPS_PATH, ngDumpName);
  const args = [`--dump-file=${pgDumpFilePath}`, `--pbf=${ngDumpOutputPath}`];

  const { exitCode } = await commandRunner.run(executable, undefined, args);

  if (exitCode !== 0) {
    logger.error(`${executable} exit with code ${exitCode as number}`);
    throw new PlanetDumpNgError(`an error occurred while running ${executable}, exit code ${exitCode as number}`);
  }

  return ngDumpOutputPath;
};

const uploadDumpToS3 = async (filePath: string, key: string): Promise<void> => {
  logger.info(`strating the upload of file ${filePath} as key ${key} to s3`);

  s3Client = new S3ClientWrapper(logger, config);

  if (!(await s3Client.validateExistance('bucket'))) {
    throw new BucketDoesNotExistError('the specified bucket does not exist');
  }

  if (await s3Client.validateExistance('object', key)) {
    throw new ObjectKeyAlreadyExistError(`object key ${key} already exist on specified bucket`);
  }

  const uploadStream = fs.createReadStream(filePath);

  await s3Client.multipartUploadWrapper(key, uploadStream);
};

const uploadToDumpServer = async (dumpMetadata: DumpMetadata): Promise<void> => {
  logger.info(`strating the upload of ${dumpMetadata.name} to dump-server`);

  const dumpClient = new DumpClient(logger, config);
  await dumpClient.postDumpMetadata({ ...dumpMetadata, bucket: dumpMetadata.bucket as string });
};

const cleanup = (): void => {
  if (s3Client) {
    s3Client.shutDown();
  }
};

const processExitSafely = (exitCode: number = ExitCodes.GENERAL_ERROR): void => {
  logger.info(`exiting safely with exit code: ${exitCode}`);

  cleanup();
  process.exit(exitCode);
};

(async (): Promise<void> => {
  logger.info('starting new job');

  const dumpMetadata = buildDumpMetadata();

  const pgDumpName = `${dumpMetadata.name}.${PG_DUMP_FILE_FORMAT}`;
  const pgDumpPath = await createPgDump(pgDumpName);

  const ngDumpPath = await createNgDump(pgDumpPath, dumpMetadata.name);

  if (appConfig.dumpUpload.s3) {
    await uploadDumpToS3(ngDumpPath, dumpMetadata.name);
    if (appConfig.dumpUpload.dumpServer) {
      await uploadToDumpServer(dumpMetadata);
    }
  }

  logger.info('job finished successfully');
})()
  .catch((error: ErrorWithExitCode) => {
    logger.error(error.message);
    jobExitCode = error.exitCode;
  })
  .finally(() => {
    processExitSafely(jobExitCode);
  });
