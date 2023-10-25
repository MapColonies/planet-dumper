import { join, dirname } from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { AxiosInstance } from 'axios';
import { NG_DUMP_DIR, SERVICES, WORKDIR } from '../../common/constants';
import { DumpServerClient } from '../../httpClient/dumpClient';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { BucketDoesNotExistError, ObjectKeyAlreadyExistError, PlanetDumpNgError } from '../../common/errors';
import { DumpMetadata, DumpServerConfig, IConfig, NgDumpConfig } from '../../common/interfaces';
import { Executable } from '../../common/types';
import { PgDumpManager } from '../pgDump/pgDumpManager';
import { nameFormat } from '../common/helpers';
import { emptyDirectory, createDirectoryIfNotAlreadyExists, getFileSize } from '../../common/util';

@injectable()
export class CreateManager extends PgDumpManager {
  public constructor(
    @inject(SERVICES.LOGGER) logger: Logger,
    @inject(SERVICES.CONFIG) config: IConfig,
    @inject(SERVICES.HTTP_CLIENT) axios: AxiosInstance,
    private readonly s3Client: S3ClientWrapper
  ) {
    super(logger, config, axios);
  }

  public async createNgDump(
    outputFormat: string,
    pgDumpFilePath: string,
    shouldResume: boolean,
    mediator?: StatefulMediator | undefined
  ): Promise<string> {
    await mediator?.reserveAccess();

    const ngDumpName = nameFormat(outputFormat, this.state);
    const currentNgDumpDir = join(WORKDIR, this.state, NG_DUMP_DIR);
    const ngDumpOutputPath = join(currentNgDumpDir, ngDumpName);
    const metadata = { ngDumpName, ngDumpOutputPath };

    await mediator?.createAction({ state: parseInt(this.state), metadata });
    await mediator?.removeLock();

    await createDirectoryIfNotAlreadyExists(currentNgDumpDir);

    // if should not resume clear already existing mid dump files
    if (!shouldResume) {
      await emptyDirectory(currentNgDumpDir);
    }

    // execute commmad
    await this.executeNgDump(pgDumpFilePath, ngDumpOutputPath, shouldResume);

    // collect metadata
    const size = await getFileSize(ngDumpOutputPath);
    await mediator?.updateAction({ metadata: { size } });

    return ngDumpOutputPath;
  }

  public async executeNgDump(pgDumpFilePath: string, ngDumpFilePath: string, shouldResume?: boolean): Promise<void> {
    this.logger.info({ msg: 'creating ng dump', pgDumpFilePath, ngDumpFilePath });

    const executable: Executable = 'planet-dump-ng';
    const globalArgs = this.globalCommandArgs[executable];
    const args = [...globalArgs, `--dump-file=${pgDumpFilePath}`, `--pbf=${ngDumpFilePath}`];
    const isVerbose = this.config.get<boolean>('ngDump.verbose');

    if (shouldResume === true) {
      args.push('--resume');
    }

    await this.commandWrapper(executable, args, PlanetDumpNgError, undefined, dirname(ngDumpFilePath), isVerbose);
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

  public async registerOnDumpServer(dumpServerConfig: Required<DumpServerConfig>, dumpMetadata: DumpMetadata): Promise<void> {
    this.logger.info({
      msg: 'uploading created dump metadata to dump server',
      dumpMetadata,
    });

    const dumpServerClient = new DumpServerClient(this.logger, this.axios);
    await dumpServerClient.postDumpMetadata(dumpServerConfig, { ...dumpMetadata, bucket: dumpMetadata.bucket as string });
  }

  protected override processConfig(config: IConfig): void {
    super.processConfig(config);

    const ngDumpConfig = config.get<NgDumpConfig>('ngDump');

    const ngDumpGlobalArgs = this.globalCommandArgs['planet-dump-ng'];

    if (ngDumpConfig.maxConcurrency) {
      ngDumpGlobalArgs.push(`--max-concurrency=${ngDumpConfig.maxConcurrency.toString()}`);
    }
  }
}
