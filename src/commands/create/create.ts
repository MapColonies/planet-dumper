import { Argv, CommandModule, Arguments } from 'yargs';
import { isWebUri } from 'valid-url';
import { Logger } from '@map-colonies/js-logger';
import { container, delay, inject, injectable } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { ExitCodes, EXIT_CODE, PG_DUMP_FILE_FORMAT, S3_REGION, SERVICES } from '../../common/constants';
import { ErrorWithExitCode } from '../../common/errors';
import { DumpNameOptions, DumpServerConfig, S3Config } from '../../common/interfaces';
import { isStringUndefinedOrEmpty } from '../../common/util';
import { CreateManager } from './createManager';

export type CreateArguments = S3Config & DumpNameOptions & DumpServerConfig;

@injectable()
export class CreateCommand implements CommandModule<Argv, CreateArguments> {
  public command = 'create';
  public describe = 'create a pbf dump from an osm database';

  public constructor(
    @inject(delay(() => CreateManager)) private readonly manager: CreateManager,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {}

  public builder = (yargs: Argv): Argv<CreateArguments> => {
    yargs
      .option('s3Endpoint', { alias: ['e', 's3-endpoint'], describe: 'The s3 endpoint', nargs: 1, type: 'string', demandOption: true })
      .option('s3BucketName', {
        alias: ['b', 's3-bucket-name'],
        describe: 'The bucket name containing the state and the lua script',
        nargs: 1,
        type: 'string',
        demandOption: true,
      })
      .option('s3ProjectId', {
        alias: ['pid', 's3-project-id'],
        describe: 'The project id for specified s3 endpoint',
        nargs: 1,
        type: 'string'
      })
      .option('s3Acl', {
        alias: ['a', 's3-acl'],
        describe: 'The canned acl policy for uploaded objects',
        choices: ['authenticated-read', 'private', 'public-read', 'public-read-write'],
        default: 'private',
      })
      .option('dumpServerEndpoint', {
        alias: ['s', 'dump-server-endpoint'],
        description: 'The endpoint of the dump-server',
        nargs: 1,
        type: 'string',
      })
      .option('dumpServerToken', {
        alias: ['tkn', 'dump-server-token'],
        description: 'The token of the dump-server used for upload',
        nargs: 1,
        type: 'string',
      })
      .option('dumpName', {
        alias: ['n', 'dump-name'],
        description: 'The result dump name',
        nargs: 1,
        type: 'string',
        demandOption: true,
      })
      .option('dumpNamePrefix', {
        alias: ['p', 'dump-name-prefix'],
        description: 'The result dump name prefix',
        nargs: 1,
        type: 'string',
      })
      .option('dumpNameTimestamp', {
        alias: ['t', 'dump-name-timestamp'],
        description: 'Add timestamp to the resulting dump name',
        nargs: 1,
        type: 'boolean',
        default: false,
      })
      .check((argv) => {
        const { dumpServerEndpoint } = argv;

        if (dumpServerEndpoint !== undefined && isWebUri(dumpServerEndpoint) === undefined) {
          throw new Error(`provided dump-server endpoint ${dumpServerEndpoint} is not a valid web uri`);
        }
        return true;
      })
      .middleware((argv) => {
        const { s3Endpoint } = argv;
        const client = new S3Client({
          endpoint: s3Endpoint,
          region: S3_REGION,
          forcePathStyle: true,
        });
        container.register(SERVICES.S3, { useValue: client });
      });
    return yargs as Argv<CreateArguments>;
  };

  public handler = async (argv: Arguments<CreateArguments>): Promise<void> => {
    const { dumpName, dumpNamePrefix, dumpNameTimestamp, s3BucketName, s3ProjectId, s3Acl, dumpServerEndpoint, dumpServerToken } = argv;

    try {
      const dumpMetadata = this.manager.buildDumpMetadata({ dumpName, dumpNamePrefix, dumpNameTimestamp }, s3BucketName);

      const pgDumpName = `${dumpMetadata.name}.${PG_DUMP_FILE_FORMAT}`;
      const pgDumpPath = await this.manager.createPgDump(pgDumpName);

      const osmDumpPath = await this.manager.createOsmDump(pgDumpPath, dumpMetadata.name);

      let bucketNameWithProjectId = s3BucketName;
      if (!isStringUndefinedOrEmpty(s3ProjectId)) {
        bucketNameWithProjectId = `${s3ProjectId as string}:${s3BucketName}`;
      }
      await this.manager.uploadFileToS3(osmDumpPath, bucketNameWithProjectId, dumpMetadata.name, s3Acl);
      if (dumpServerEndpoint) {
        await this.manager.registerOnDumpServer({ dumpServerEndpoint, dumpServerToken }, dumpMetadata);
      }

      this.logger.info(`successfully created ${dumpMetadata.name}`);
    } catch (error) {
      let exitCode = ExitCodes.GENERAL_ERROR;
      if (error instanceof ErrorWithExitCode) {
        exitCode = error.exitCode;
      } else {
        this.logger.error((error as Error).message);
      }

      container.register(EXIT_CODE, { useValue: exitCode });
      this.logger.warn(`an error occurred, exiting with code ${exitCode}`);
    }
  };
}
