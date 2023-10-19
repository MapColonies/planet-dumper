import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { DEFAULT_STATE, NG_DUMP_DIR, SERVICES, WORKDIR } from '../../common/constants';
import { DumpServerClient } from '../../httpClient/dumpClient';
import { S3ClientWrapper } from '../../s3client/s3Client';
import { BucketDoesNotExistError, ObjectKeyAlreadyExistError, PlanetDumpNgError } from '../../common/errors';
import { DumpMetadata, DumpServerConfig, IConfig } from '../../common/interfaces';
import { Executable } from '../../common/types';
import { PgDumpManager } from '../pgDump/pgDumpManager';
import { CleanupMode } from '../common/types';
import { nameFormat } from '../common/helpers';
import { createDirectory } from '../../common/util';

const buildDumpMetadata = (format: string, metadata: Partial<DumpMetadata>): DumpMetadata => {
  const now = new Date();
  const { sequenceNumber, bucket } = metadata;
  const name = nameFormat(format, sequenceNumber?.toString());

  return {
    name,
    bucket,
    timestamp: now,
    sequenceNumber: sequenceNumber ?? DEFAULT_STATE, // TODO: fix
  };
};

@injectable()
export class CreateManager extends PgDumpManager {
  public constructor(
    @inject(SERVICES.LOGGER) logger: Logger,
    @inject(SERVICES.CONFIG) config: IConfig,
    private readonly dumpServerClient: DumpServerClient,
    private readonly s3Client: S3ClientWrapper
  ) {
    super(logger, config, dumpServerClient.axios); // TODO: fix this inheritance
  }

  public async createNgDump(
    stateSource: string,
    dumpNameFormat: string,
    cleanupMode: CleanupMode,
    pgDumpFilePath: string,
    s3BucketName: string,
    mediator?: StatefulMediator | undefined
  ): Promise<string> {
    await mediator?.reserveAccess();

    const state = await this.getState(stateSource);

    const dumpMetadata = buildDumpMetadata(dumpNameFormat, { bucket: s3BucketName, sequenceNumber: parseInt(state) });

    await mediator?.createAction({ state: parseInt(state), metadata: dumpMetadata });
    await mediator?.removeLock();

    // TODO: cleanup mode
    // TODO: create/flush state dir depends on continous arg
    const currentNgDumpDir = join(WORKDIR, state, NG_DUMP_DIR);
    await createDirectory(currentNgDumpDir);
    const ngDumpOutputPath = join(currentNgDumpDir, dumpMetadata.name);

    // execute commmad
    await this.executeNgDump(pgDumpFilePath, ngDumpOutputPath);

    return ngDumpOutputPath;
  }

  public async executeNgDump(pgDumpFilePath: string, ngDumpFilePath: string): Promise<void> {
    this.logger.info({ msg: 'creating ng dump', pgDumpFilePath, ngDumpFilePath });

    const executable: Executable = 'planet-dump-ng';
    const args = [`--dump-file=${pgDumpFilePath}`, `--pbf=${ngDumpFilePath}`];

    await this.commandWrapper(executable, args, PlanetDumpNgError);
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

    await this.dumpServerClient.postDumpMetadata(dumpServerConfig, { ...dumpMetadata, bucket: dumpMetadata.bucket as string });
  }
}
