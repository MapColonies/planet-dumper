import { join } from 'path';
import fs from 'fs';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { NG_DUMPS_PATH, PBF_FILE_FORMAT, PG_DUMPS_PATH, SERVICES } from '../../common/constants';
import { DumpServerClient } from '../../httpClient/dumpClient';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { CommandRunner } from '../../common/commandRunner';
import { BucketDoesNotExistError, ObjectKeyAlreadyExistError, PgDumpError, PlanetDumpNgError } from '../../common/errors';
import { DumpMetadata, DumpNameOptions, DumpServerConfig } from '../../common/interfaces';
import { Executable } from '../../common/types';

@injectable()
export class CreateManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    private readonly s3Client: S3ClientWrapper,
    private readonly dumpServerClient: DumpServerClient,
    private readonly commandRunner: CommandRunner
  ) {}

  public buildDumpMetadata(dumpNameOptions: DumpNameOptions, bucketName: string): DumpMetadata {
    const { dumpNamePrefix, dumpName, dumpNameTimestamp } = dumpNameOptions;
    let name = dumpNamePrefix !== undefined ? `${dumpNamePrefix}_${dumpName}` : dumpName;

    const currentTimestamp = new Date();
    if (dumpNameTimestamp) {
      name += `_${currentTimestamp.toISOString()}`;
    }

    return {
      name: `${name}.${PBF_FILE_FORMAT}`,
      bucket: bucketName,
      timestamp: currentTimestamp,
    };
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

  public async uploadFileToS3(filePath: string, bucketName: string, key: string, acl: string): Promise<void> {
    this.logger.info({ msg: 'uploading file to bucket', bucketName, filePath, key, acl });

    if (!(await this.s3Client.validateExistance('bucket', bucketName))) {
      throw new BucketDoesNotExistError('the specified bucket does not exist');
    }

    if (await this.s3Client.validateExistance('object', key, bucketName)) {
      throw new ObjectKeyAlreadyExistError(`object key ${key} already exist on specified bucket`);
    }

    const uploadStream = fs.createReadStream(filePath);

    await this.s3Client.putObjectWrapper(bucketName, key, uploadStream, acl);
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
}
