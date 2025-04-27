import { join } from 'path';
import { Argv, CommandModule, Arguments } from 'yargs';
import { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { container, FactoryFunction } from 'tsyringe';
import { S3Client } from '@aws-sdk/client-s3';
import { ExitCodes, EXIT_CODE, S3_REGION, SERVICES, WORKDIR } from '../../common/constants';
import { ErrorWithExitCode } from '../../common/errors';
import { check as checkWrapper } from '../../wrappers/check';
import { ExtendedCleanupMode, GlobalArguments } from '../common/types';
import { ArstotzkaConfig, DumpServerConfig, S3Config } from '../../common/interfaces';
import { stateSourceCheck } from '../common/checks';
import { terminateChildren } from '../../common/spawner';
import { emptyDirectory } from '../../common/util';
import { buildDumpMetadata } from '../common/helpers';
import { CreateManager } from './createManager';
import { httpHeadersCheck, dumpServerUriCheck } from './checks';
import { CREATE_MANAGER_FACTORY } from './createManagerFactory';

export const CREATE_COMMAND_FACTORY = Symbol('CreateCommandFactory');

export interface CreateArguments extends GlobalArguments, S3Config, DumpServerConfig {
  resume: boolean;
  info: boolean;
}

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
        alias: ['d', 'dump-server-endpoint'],
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
      .option('cleanupMode', {
        alias: 'c',
        describe: 'the command execution cleanup mode',
        choices: ['none', 'pre-clean-others', 'post-clean-others', 'post-clean-workdir', 'post-clean-all'] as ExtendedCleanupMode[],
        nargs: 1,
        type: 'string',
        default: 'none' as ExtendedCleanupMode,
      })
      .option('resume', {
        alias: ['r', 'resume'],
        describe: 'resume already existing dump state',
        type: 'boolean',
        default: false,
      })
      .option('info', {
        alias: ['i', 'info'],
        describe: 'collect info on the resulted dump',
        type: 'boolean',
        default: false,
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
    const {
      stateSource,
      outputFormat,
      cleanupMode,
      resume: shouldResume,
      info: shouldCollectInfo,
      s3BucketName,
      s3Acl,
      dumpServerEndpoint,
      dumpServerHeaders,
    } = args;

    logger.debug({ msg: 'starting command execution', command, args });

    let pgMediator: StatefulMediator | undefined;
    let ngMediator: StatefulMediator | undefined;

    const arstotzkaConfig = dependencyContainer.resolve<ArstotzkaConfig>(SERVICES.ARSTOTZKA);
    if (arstotzkaConfig.enabled) {
      pgMediator = new StatefulMediator({ ...arstotzkaConfig.mediator, serviceId: arstotzkaConfig.services['planetDumperPg'], logger });
      ngMediator = new StatefulMediator({ ...arstotzkaConfig.mediator, serviceId: arstotzkaConfig.services['planetDumperNg'], logger });
    }

    const manager = dependencyContainer.resolve<CreateManager>(CREATE_MANAGER_FACTORY);

    try {
      // get state
      const state = await manager.getState(stateSource);

      // pre cleanup
      if (cleanupMode === 'pre-clean-others') {
        await emptyDirectory(WORKDIR, [state]);
      }

      // create pg dump or resume from existing one
      const pgDumpFilePath = await manager.createPgDump(outputFormat, shouldResume, pgMediator);

      // create ng dump
      const ngDumpFilePath = await manager.createNgDump(outputFormat, pgDumpFilePath, shouldResume, shouldCollectInfo, ngMediator);

      // build metadata
      const metadata = buildDumpMetadata(outputFormat, state);

      // s3 upload
      await manager.uploadDumpToS3(ngDumpFilePath, s3BucketName, metadata.name, s3Acl);

      // dump server upload
      if (dumpServerEndpoint !== undefined) {
        await manager.registerOnDumpServer({ dumpServerEndpoint, dumpServerHeaders }, { ...metadata, bucket: s3BucketName });
      }

      // post cleanup
      if (cleanupMode === 'post-clean-workdir') {
        await emptyDirectory(join(WORKDIR, state));
      } else if (cleanupMode === 'post-clean-others') {
        await emptyDirectory(WORKDIR, [state]);
      } else if (cleanupMode === 'post-clean-all') {
        await emptyDirectory(WORKDIR);
      }

      await ngMediator?.updateAction({ status: ActionStatus.COMPLETED, metadata: { dumpServerPayload: { ...metadata, bucket: s3BucketName } } });

      logger.info({ msg: 'finished command execution successfully', command, args });
    } catch (error) {
      let exitCode = ExitCodes.GENERAL_ERROR;

      if (error instanceof ErrorWithExitCode) {
        exitCode = error.exitCode;
      }

      terminateChildren();
      await ngMediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });

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
