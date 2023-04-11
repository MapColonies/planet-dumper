import fsPromises from 'fs/promises';
import { Argv, CommandModule, Arguments } from 'yargs';
import { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { container, FactoryFunction } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { DEFAULT_SEQUENCE_NUMBER, ExitCodes, EXIT_CODE, PG_DUMP_FILE_FORMAT, S3_REGION, SERVICES } from '../../common/constants';
import { CheckError, ErrorWithExitCode } from '../../common/errors';
import { ArstotzkaConfig, DumpMetadataOptions, DumpServerConfig, S3Config } from '../../common/interfaces';
import { CreateManager, CREATE_MANAGER_FACTORY } from './createManager';
import { CheckFunc, dumpServerUriCheck, httpHeadersCheck } from './checks';

export const CREATE_COMMAND_FACTORY = Symbol('CreateCommandFactory');

export type CreateArguments = S3Config & DumpMetadataOptions & DumpServerConfig;

export const createCommandFactory: FactoryFunction<CommandModule<Argv, CreateArguments>> = (dependencyContainer) => {
  const command = 'create';

  const describe = 'create a pbf dump from an osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const checkWrapper = (check: CheckFunc<CreateArguments>): CheckFunc<CreateArguments> => {
    const wrapper: CheckFunc<CreateArguments> = (argv) => {
      try {
        return check(argv);
      } catch (err) {
        if (err instanceof CheckError) {
          logger.error({
            msg: err.message,
            command: command,
            argument: err.argument,
            received: err.received,
          });
        }
        throw err;
      }
    };
    return wrapper;
  };

  const builder = (yargs: Argv): Argv<CreateArguments> => {
    yargs
      .option('s3Endpoint', { alias: ['e', 's3-endpoint'], describe: 'The s3 endpoint', nargs: 1, type: 'string', demandOption: true })
      .option('s3BucketName', {
        alias: ['b', 's3-bucket-name'],
        describe: 'The bucket name containing the state and the lua script',
        nargs: 1,
        type: 'string',
        demandOption: true,
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
      .option('dumpServerHeaders', {
        alias: ['H', 'dump-server-headers'],
        description: 'The headers to attach to the dump-server request',
        array: true,
        type: 'string',
        default: [] as string[],
      })
      .option('dumpNameFormat', {
        alias: ['n', 'dump-name-format'],
        description: 'The resulting dump name format, example: prefix_{timestamp}_suffix.pbf',
        nargs: 1,
        type: 'string',
        demandOption: true,
      })
      .option('stateBucketName', {
        alias: ['sbn', 'state-bucket-name'],
        description: 'Determines state seqeunce number according to this bucket state file, locks the bucket until creation completes',
        nargs: 1,
        type: 'string',
      })
      .check(checkWrapper(dumpServerUriCheck))
      .check(checkWrapper(httpHeadersCheck))
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

  const handler = async (args: Arguments<CreateArguments>): Promise<void> => {
    const { awsSecretAccessKey, awsAccessKeyId, pgpassword, pguser, dumpServerHeaders, ...restOfArgs } = args;

    logger.debug({ msg: 'starting command execution', command: command, args: restOfArgs });

    const { stateBucketName, dumpNameFormat, s3BucketName, s3Acl, dumpServerEndpoint } = restOfArgs;

    let mediator: StatefulMediator | undefined;

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    if (arstotzkaConfig.enabled) {
      mediator = new StatefulMediator({ ...arstotzkaConfig.mediator, serviceId: arstotzkaConfig.serviceId, logger });
    }

    const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);

    try {
      await mediator?.reserveAccess();

      const dumpMetadataOptions: DumpMetadataOptions = { stateBucketName, dumpNameFormat };
      const dumpMetadata = await manager.buildDumpMetadata(dumpMetadataOptions, s3BucketName);

      await mediator?.createAction({ state: dumpMetadata.sequenceNumber ?? DEFAULT_SEQUENCE_NUMBER, metadata: { name: dumpMetadata.name } });

      await mediator?.removeLock();

      const pgDumpName = `${dumpMetadata.name}.${PG_DUMP_FILE_FORMAT}`;
      const pgDumpPath = await manager.createPgDump(pgDumpName);

      const osmDumpPath = await manager.createOsmDump(pgDumpPath, dumpMetadata.name);

      const dumpBuffer = await fsPromises.readFile(osmDumpPath);
      await manager.uploadBufferToS3(dumpBuffer, s3BucketName, dumpMetadata.name, s3Acl);

      if (dumpServerEndpoint !== undefined) {
        await manager.registerOnDumpServer({ dumpServerEndpoint, dumpServerHeaders }, dumpMetadata);
      }

      await mediator?.updateAction({ status: ActionStatus.COMPLETED });

      logger.info({ msg: 'finished command execution successfully', command: command, dumpMetadata });
    } catch (error) {
      let exitCode = ExitCodes.GENERAL_ERROR;

      if (error instanceof ErrorWithExitCode) {
        exitCode = error.exitCode;
      }

      await mediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });

      container.register(EXIT_CODE, { useValue: exitCode });
      logger.error({ err: error, msg: 'an error occurred while executing command', command: command, exitCode });
    }
  };

  return {
    command,
    describe,
    builder,
    handler,
  };
};
