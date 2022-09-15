import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import Format from 'string-format';
import { NG_DUMPS_PATH, PG_DUMPS_PATH, S3_LOCK_FILE_NAME, SERVICES, STATE_FILE_NAME } from '../../common/constants';
import { DumpServerClient } from '../../httpClient/dumpClient';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { CommandRunner } from '../../common/commandRunner';
import { BucketDoesNotExistError, InvalidStateFileError, ObjectKeyAlreadyExistError, PgDumpError, PlanetDumpNgError } from '../../common/errors';
import { DumpMetadata, DumpMetadataOptions, DumpServerConfig } from '../../common/interfaces';
import { Executable } from '../../common/types';
import { fetchSequenceNumber, streamToString } from '../../common/util';

@injectable()
export class CreateManager {
  private readonly creationTimestamp: Date;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    private readonly s3Client: S3ClientWrapper,
    private readonly dumpServerClient: DumpServerClient,
    private readonly commandRunner: CommandRunner
  ) {
    this.creationTimestamp = new Date();
  }

  public async buildDumpMetadata(dumpMetadataOptions: DumpMetadataOptions, bucketName: string): Promise<DumpMetadata> {
    const { stateBucketName, dumpNameFormat, includeState } = dumpMetadataOptions;

    const sequenceNumber = await this.getSequenceNumber(stateBucketName);

    const metadata = { timestamp: this.creationTimestamp.toISOString(), sequenceNumber };

    const name = Format(dumpNameFormat, metadata);

    let dumpMetadata: DumpMetadata = {
      name,
      bucket: bucketName,
      timestamp: this.creationTimestamp,
    };

    if (includeState) {
      dumpMetadata = { ...dumpMetadata, sequenceNumber };
    }

    return dumpMetadata;
  }

  public async createPgDump(dumpTableName: string): Promise<string> {
    this.logger.info({ msg: 'creating pg dump', dumpTableName });

    const executable: Executable = 'pg_dump';
    const pgDumpOutputPath = join(PG_DUMPS_PATH, dumpTableName);
    const args = ['--format=custom', `--file=${pgDumpOutputPath}`];

    await this.commandWrapper(executable, args, PgDumpError);

    return pgDumpOutputPath;
  }

  public async createOsmDump(pgDumpFilePath: string, osmDumpName: string): Promise<string> {
    this.logger.info({ msg: 'creating ng dump', osmDumpName, pgDumpFilePath });

    const executable: Executable = 'planet-dump-ng';
    const osmDumpOutputPath = join(NG_DUMPS_PATH, osmDumpName);
    const args = [`--dump-file=${pgDumpFilePath}`, `--pbf=${osmDumpOutputPath}`];

    await this.commandWrapper(executable, args, PlanetDumpNgError);

    return osmDumpOutputPath;
  }

  public async lockS3(bucketName: string): Promise<void> {
    this.logger.info({ msg: 'locking s3 bucket', bucketName, lockFileName: S3_LOCK_FILE_NAME });

    const lockfileBuffer = Buffer.alloc(1, 0);

    await this.uploadBufferToS3(lockfileBuffer, bucketName, S3_LOCK_FILE_NAME, 'public-read');
  }

  public async unlockS3(bucketName: string): Promise<void> {
    this.logger.info({ msg: 'unlocking s3 bucket', bucketName, lockFileName: S3_LOCK_FILE_NAME });

    await this.s3Client.deleteObjectWrapper(bucketName, S3_LOCK_FILE_NAME);
  }

  public async getSequenceNumber(bucketName: string): Promise<number> {
    this.logger.info({ msg: 'getting current sequence sequence number from s3', bucketName });

    const stateStream = await this.s3Client.getObjectWrapper(bucketName, STATE_FILE_NAME);
    const stateContent = await streamToString(stateStream);
    const sequenceNumber = this.fetchSequenceNumberSafely(stateContent);
    return sequenceNumber;
  }

  public async uploadBufferToS3(buffer: Buffer, bucketName: string, key: string, acl: string): Promise<void> {
    this.logger.info({ msg: 'uploading file to bucket', bucketName, key, acl });

    if (!(await this.s3Client.validateExistance('bucket', bucketName))) {
      throw new BucketDoesNotExistError('the specified bucket does not exist');
    }

    if (await this.s3Client.validateExistance('object', key, bucketName)) {
      throw new ObjectKeyAlreadyExistError(`object key ${key} already exist on specified bucket`);
    }

    await this.s3Client.putObjectWrapper(bucketName, key, buffer, acl);
  }

  public async registerOnDumpServer(dumpServerConfig: DumpServerConfig, dumpMetadata: DumpMetadata): Promise<void> {
    this.logger.info({
      msg: 'uploading created dump metadata to dump server',
      dumpMetadata,
      dumpServerEndpoint: dumpServerConfig.dumpServerEndpoint,
    });

    await this.dumpServerClient.postDumpMetadata(dumpServerConfig, { ...dumpMetadata, bucket: dumpMetadata.bucket as string });
  }

  private async commandWrapper(executable: Executable, args: string[], error: new (message?: string) => Error, command?: string): Promise<void> {
    this.logger.info({ msg: 'executing command', executable, command, args });

    const { exitCode } = await this.commandRunner.run(executable, command, args);

    if (exitCode !== 0) {
      this.logger.error({ msg: 'failure occurred during the execute of command', executable, command, args, executableExitCode: exitCode });
      throw new error(`an error occurred while running ${executable} with ${command ?? 'undefined'} command, exit code ${exitCode as number}`);
    }
  }

  private fetchSequenceNumberSafely(content: string): number {
    try {
      return fetchSequenceNumber(content);
    } catch (error) {
      this.logger.error({ err: error, msg: 'failed to fetch sequence number out of the state file' });
      throw new InvalidStateFileError('could not fetch sequence number out of the state file');
    }
  }
}
