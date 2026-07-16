import { join } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import type { MediatorConfig } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { WORKDIR } from '@common/constants';
import type { ArstotzkaConfig } from '@common/interfaces';
import { emptyDirectory } from '@common/util';
import type { PgDumpManager } from '../pgDump/pgDumpManager';
import type { CreateManager } from '../create/createManager';
import { buildDumpMetadata } from './helpers';
import type { CleanupMode, ExtendedCleanupMode } from './types';

// the arstotzka.mediator.{actiony,locky} remotes are optional keys upstream (MediatorConfig), but the
// schema always provides the key with a possibly-empty url - only include a remote when its url is set
const buildMediatorConfig = (mediator: ArstotzkaConfig['mediator']): MediatorConfig => {
  const { timeout, enableRetryStrategy, retryStrategy, actiony, locky } = mediator;

  return {
    timeout,
    enableRetryStrategy,
    retryStrategy,
    ...(actiony.url !== undefined ? { actiony: { url: actiony.url } } : {}),
    ...(locky.url !== undefined ? { locky: { url: locky.url } } : {}),
  };
};

export interface PgDumpPipelineArgs {
  outputFormat: string;
  stateSource: string;
  cleanupMode: CleanupMode | ExtendedCleanupMode;
}

export interface CreatePipelineArgs {
  outputFormat: string;
  stateSource: string;
  cleanupMode: CleanupMode | ExtendedCleanupMode;
  resume: boolean;
  info: boolean;
  s3BucketName: string;
  s3Acl: string;
  dumpServerEndpoint?: string;
  dumpServerHeaders: string[];
}

export const runPgDumpPipeline = async (
  manager: PgDumpManager,
  args: PgDumpPipelineArgs,
  logger: Logger,
  arstotzkaConfig: ArstotzkaConfig
): Promise<void> => {
  const { outputFormat, stateSource, cleanupMode } = args;

  let pgMediator: StatefulMediator | undefined;
  if (arstotzkaConfig.enabled) {
    const { planetDumperPg: pgServiceId } = arstotzkaConfig.services;
    if (pgServiceId === undefined) {
      throw new Error('arstotzka.services.planetDumperPg must be configured when arstotzka is enabled');
    }
    pgMediator = new StatefulMediator({ ...buildMediatorConfig(arstotzkaConfig.mediator), serviceId: pgServiceId, logger });
  }

  try {
    const state = await manager.getState(stateSource);

    // pre cleanup
    if (cleanupMode === 'pre-clean-others') {
      await emptyDirectory(WORKDIR, [state]);
    }

    await manager.createPgDump(outputFormat, false, pgMediator);

    // post cleanup
    if (cleanupMode === 'post-clean-others') {
      await emptyDirectory(WORKDIR, [state]);
    }
  } catch (error) {
    await pgMediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });
    throw error;
  }
};

export const runCreatePipeline = async (
  manager: CreateManager,
  args: CreatePipelineArgs,
  logger: Logger,
  arstotzkaConfig: ArstotzkaConfig
): Promise<void> => {
  const {
    outputFormat,
    stateSource,
    cleanupMode,
    resume: shouldResume,
    info: shouldCollectInfo,
    s3BucketName,
    s3Acl,
    dumpServerEndpoint,
    dumpServerHeaders,
  } = args;

  let pgMediator: StatefulMediator | undefined;
  let ngMediator: StatefulMediator | undefined;
  if (arstotzkaConfig.enabled) {
    const { planetDumperPg: pgServiceId, planetDumperNg: ngServiceId } = arstotzkaConfig.services;
    if (pgServiceId === undefined || ngServiceId === undefined) {
      throw new Error('arstotzka.services.planetDumperPg and planetDumperNg must be configured when arstotzka is enabled');
    }
    const mediatorConfig = buildMediatorConfig(arstotzkaConfig.mediator);
    pgMediator = new StatefulMediator({ ...mediatorConfig, serviceId: pgServiceId, logger });
    ngMediator = new StatefulMediator({ ...mediatorConfig, serviceId: ngServiceId, logger });
  }

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
    const metadata = buildDumpMetadata(outputFormat, manager.timestamp, state);

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
  } catch (error) {
    await ngMediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });
    throw error;
  }
};
