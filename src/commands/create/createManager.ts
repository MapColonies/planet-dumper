import { join, dirname } from 'node:path';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import type { AxiosInstance } from 'axios';
import { NG_DUMP_DIR, SERVICES, WORKDIR } from '@common/constants';
import { DumpServerClient } from '@src/httpClient/dumpClient';
import { S3ClientWrapper } from '@src/s3client/s3Client';
import { FsRepository } from '@src/fsRepository/fsRepository';
import { BucketDoesNotExistError, ObjectKeyAlreadyExistError, OsmiumError, PlanetDumpNgError } from '@common/errors';
import type { DumpMetadata, DumpServerConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';
import { Executable } from '@common/types';
import { PgDumpManager } from '../pgDump/pgDumpManager';
import { nameFormat } from '../common/helpers';
import type { CleanupMode } from '../common/types';

export interface S3Uploader {
  validateExistance: S3ClientWrapper['validateExistance'];
  uploadStreamInParallel: S3ClientWrapper['uploadStreamInParallel'];
}

@injectable()
export class CreateManager extends PgDumpManager {
  public constructor(
    @inject(SERVICES.LOGGER) logger: Logger,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.HTTP_CLIENT) axios: AxiosInstance,
    @inject(FsRepository) fsRepository: FsRepository,
    @inject(S3ClientWrapper) private readonly s3Client: S3Uploader
  ) {
    super(logger, config, axios, fsRepository);
  }

  public async createNgDump(
    outputFormat: string,
    pgDumpFilePath: string,
    shouldResume: boolean,
    shouldCollectInfo: boolean,
    mediator?: StatefulMediator
  ): Promise<string> {
    await mediator?.reserveAccess();

    const ngDumpName = nameFormat(outputFormat, this.timestamp, this.state);
    const currentNgDumpDir = join(WORKDIR, this.state, NG_DUMP_DIR);
    const ngDumpOutputPath = join(currentNgDumpDir, ngDumpName);
    const metadata: Record<string, unknown> = { ngDumpName, ngDumpOutputPath };

    await mediator?.createAction({ state: parseInt(this.state), metadata });
    await mediator?.removeLock();

    await this.fsRepository.createDirectoryIfNotAlreadyExists(currentNgDumpDir);

    // if should not resume clear already existing mid dump files
    if (!shouldResume) {
      await this.fsRepository.emptyDirectory(currentNgDumpDir);
    }

    // execute commmad
    await this.executeNgDump(pgDumpFilePath, ngDumpOutputPath, shouldResume);

    // collect metadata
    metadata.size = await this.fsRepository.getFileSize(ngDumpOutputPath);

    if (shouldCollectInfo) {
      const collectedInfo = await this.executeOsmium(ngDumpOutputPath);
      metadata.info = JSON.parse(collectedInfo) as Record<string, unknown>;
    }

    await mediator?.updateAction({ metadata });

    return ngDumpOutputPath;
  }

  public async executeNgDump(pgDumpFilePath: string, ngDumpFilePath: string, shouldResume?: boolean): Promise<void> {
    this.logger.info({ msg: 'creating ng dump', pgDumpFilePath, ngDumpFilePath });

    const executable: Executable = 'planet-dump-ng';
    const globalArgs = this.globalCommandArgs[executable];
    const args = [...globalArgs, `--dump-file=${pgDumpFilePath}`, `--pbf=${ngDumpFilePath}`];
    const isVerbose = this.config.get('ngDump.verbose');

    if (shouldResume === true) {
      args.push('--resume');
    }

    await this.commandWrapper(executable, args, PlanetDumpNgError, undefined, dirname(ngDumpFilePath), isVerbose);
  }

  public async executeOsmium(ngDumpFilePath: string): Promise<string> {
    this.logger.info({ msg: 'collecting ng dump file info', ngDumpFilePath });

    const executable: Executable = 'osmium';
    const globalArgs = this.globalCommandArgs[executable];
    const args = [...globalArgs, '--input-format', 'pbf', '--extended', '--json', ngDumpFilePath];
    const isVerbose = this.config.get('osmium.verbose');

    return this.commandWrapper(executable, args, OsmiumError, 'fileinfo', undefined, isVerbose);
  }

  public async uploadDumpToS3(path: string, bucketName: string, key: string, acl: string): Promise<void> {
    this.logger.info({ msg: 'uploading file to bucket', bucketName, key, acl });

    if (!(await this.s3Client.validateExistance('bucket', bucketName))) {
      throw new BucketDoesNotExistError('the specified bucket does not exist');
    }

    if (await this.s3Client.validateExistance('object', key, bucketName)) {
      throw new ObjectKeyAlreadyExistError(`object key ${key} already exist on specified bucket`);
    }

    const fileStream = this.fsRepository.createFileReadStream(path);

    await this.s3Client.uploadStreamInParallel(bucketName, key, fileStream, acl);
  }

  public async registerOnDumpServer(dumpServerConfig: Required<DumpServerConfig>, dumpMetadata: DumpMetadata): Promise<void> {
    this.logger.info({
      msg: 'uploading created dump metadata to dump server',
      dumpMetadata,
    });

    const dumpServerClient = new DumpServerClient(this.logger, this.axios);
    await dumpServerClient.postDumpMetadata(dumpServerConfig, { ...dumpMetadata, bucket: dumpMetadata.bucket as string });
  }

  public override async postCleanup(mode: CleanupMode, state: string): Promise<void> {
    const postCleanupActions: Record<CleanupMode, () => Promise<void>> = {
      'post-clean-workdir': async () => this.fsRepository.emptyDirectory(join(WORKDIR, state)),
      'post-clean-others': async () => this.fsRepository.emptyDirectory(WORKDIR, [state]),
      'post-clean-all': async () => this.fsRepository.emptyDirectory(WORKDIR),
      none: async () => {},
      'pre-clean-others': async () => {},
    };

    await postCleanupActions[mode]();
  }

  protected override processConfig(config: ConfigType): void {
    super.processConfig(config);

    const ngDumpConfig = config.get('ngDump');

    const ngDumpGlobalArgs = this.globalCommandArgs['planet-dump-ng'];

    if (ngDumpConfig.maxConcurrency !== undefined) {
      ngDumpGlobalArgs.push(`--max-concurrency=${ngDumpConfig.maxConcurrency.toString()}`);
    }

    const osmiumConfig = config.get('osmium');
    const osmiumArgs = this.globalCommandArgs.osmium;

    if (osmiumConfig.verbose) {
      osmiumArgs.push('--verbose');
    }
    osmiumArgs.push(`${osmiumConfig.progress ? '--progress' : '--no-progress'}`);
  }
}
