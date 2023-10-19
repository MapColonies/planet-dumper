import fsPromises from 'fs/promises';
import { Argv, CommandModule, Arguments } from 'yargs';
import { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { container, FactoryFunction } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { ExitCodes, EXIT_CODE, S3_REGION, SERVICES } from '../../common/constants';
import { ErrorWithExitCode } from '../../common/errors';
import { check as checkWrapper } from '../../wrappers/check';
import { GlobalArguments } from '../common/types';
import { ArstotzkaConfig, DumpMetadata, DumpServerConfig, S3Config } from '../../common/interfaces';
import { stateSourceCheck } from '../common/checks';
import { terminateChildren } from '../../processes/spawner';
import { CreateManager } from './createManager';
import { httpHeadersCheck, dumpServerUriCheck } from './checks';
import { CREATE_MANAGER_FACTORY } from './createManagerFactory';

export const CREATE_COMMAND_FACTORY = Symbol('CreateCommandFactory');

export type CreateArguments = GlobalArguments & S3Config & DumpServerConfig;

// TODO: rename file name to createFactory
export const createCommandFactory: FactoryFunction<CommandModule<CreateArguments, CreateArguments>> = (dependencyContainer) => {
  const command = 'create';

  const describe = 'create a pbf dump from an osm database';

  const logger = dependencyContainer.resolve<Logger>(SERVICES.LOGGER);

  const builder = (yargs: Argv<CreateArguments>): Argv<CreateArguments> => {
    yargs
      .option('s3Endpoint', { alias: ['e', 's3-endpoint'], describe: 'The s3 endpoint', nargs: 1, type: 'string', demandOption: true })
      .option('s3BucketName', {
        alias: ['b', 's3-bucket-name'],
        describe: 'The bucket the resulting dump will be uploaded to',
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
      .check(checkWrapper(stateSourceCheck, logger))
      .check(checkWrapper(dumpServerUriCheck, logger))
      .check(checkWrapper(httpHeadersCheck, logger))
      .middleware((argv) => {
        const { s3Endpoint } = argv;
        const client = new S3Client({
          endpoint: s3Endpoint,
          region: S3_REGION,
          forcePathStyle: true,
        });
        container.register(SERVICES.S3, { useValue: client });
      });
    return yargs;
  };

  const handler = async (args: Arguments<CreateArguments>): Promise<void> => {
    const { stateSource, outputFormat, cleanupMode, s3BucketName, s3Acl, dumpServerEndpoint, dumpServerHeaders } = args;

    logger.debug({ msg: 'starting command execution', command, args });

    let pgMediator: StatefulMediator | undefined;
    let ngMediator: StatefulMediator | undefined;

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    if (arstotzkaConfig.enabled) {
      pgMediator = new StatefulMediator({ ...arstotzkaConfig.mediator, serviceId: arstotzkaConfig.services['planetDumpPg'], logger });
      ngMediator = new StatefulMediator({ ...arstotzkaConfig.mediator, serviceId: arstotzkaConfig.services['planetDumpNg'], logger });
    }

    const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);

    try {
      // TODO: skip if existing and continues
      const pgDumpFilePath = await manager.createPgDump(stateSource, outputFormat, cleanupMode, pgMediator);
      const ngDumpFilePath = await manager.createNgDump(stateSource, outputFormat, cleanupMode, pgDumpFilePath, s3BucketName, ngMediator);

      const ngDumpBuffer = await fsPromises.readFile(ngDumpFilePath);
      await manager.uploadBufferToS3(ngDumpBuffer, s3BucketName, 'dumpMetadata.name', s3Acl); // TODO: fix

      if (dumpServerEndpoint !== undefined) {
        await manager.registerOnDumpServer({ dumpServerEndpoint, dumpServerHeaders }, 'dumpMetadata' as unknown as DumpMetadata); // TODO: fix
      }

      await pgMediator?.updateAction({ status: ActionStatus.COMPLETED });

      logger.info({ msg: 'finished command execution successfully', command, args });
    } catch (error) {
      let exitCode = ExitCodes.GENERAL_ERROR;

      if (error instanceof ErrorWithExitCode) {
        exitCode = error.exitCode;
      }

      terminateChildren();
      await pgMediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });

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
