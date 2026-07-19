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

const buildMediatorConfig = (mediator: Extract<ArstotzkaConfig, { enabled: true }>['mediator']): MediatorConfig => {
  const { timeout, enableRetryStrategy, retryStrategy, actiony, locky } = mediator;

  return { timeout, enableRetryStrategy, retryStrategy, actiony, locky };
};

const buildMediators = (arstotzkaConfig: ArstotzkaConfig, logger: Logger): { pgMediator?: StatefulMediator; ngMediator?: StatefulMediator } => {
  if (!arstotzkaConfig.enabled) {
    return {};
  }
  const mediatorConfig = buildMediatorConfig(arstotzkaConfig.mediator);
  const pgMediator = new StatefulMediator({ ...mediatorConfig, serviceId: arstotzkaConfig.services.planetDumperPg, logger });
  const ngMediator = new StatefulMediator({ ...mediatorConfig, serviceId: arstotzkaConfig.services.planetDumperNg, logger });

  return { pgMediator, ngMediator };
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

  const { pgMediator } = buildMediators(arstotzkaConfig, logger);

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

  const { pgMediator, ngMediator } = buildMediators(arstotzkaConfig, logger);

  try {
    const state = await manager.getState(stateSource);

    if (cleanupMode === 'pre-clean-others') {
      await emptyDirectory(WORKDIR, [state]);
    }

    const pgDumpFilePath = await manager.createPgDump(outputFormat, shouldResume, pgMediator);

    const ngDumpFilePath = await manager.createNgDump(outputFormat, pgDumpFilePath, shouldResume, shouldCollectInfo, ngMediator);

    const metadata = buildDumpMetadata(outputFormat, manager.timestamp, state);

    await manager.uploadDumpToS3(ngDumpFilePath, s3BucketName, metadata.name, s3Acl);

    if (dumpServerEndpoint !== undefined) {
      await manager.registerOnDumpServer({ dumpServerEndpoint, dumpServerHeaders }, { ...metadata, bucket: s3BucketName });
    }

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
