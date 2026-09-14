import type { Logger } from '@map-colonies/js-logger';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import type { MediatorConfig } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { PgDumpManager } from '../pgDump/pgDumpManager';
import type { CreateManager } from '../create/createManager';
import { buildDumpMetadata } from './helpers';
import type { CleanupMode } from './types';

const buildMediatorConfig = (mediator: Extract<ArstotzkaConfig, { enabled: true }>['mediator']): MediatorConfig => {
  const { timeout, enableRetryStrategy, retryStrategy, actiony, locky } = mediator;

  return { timeout, enableRetryStrategy, retryStrategy, actiony, locky };
};

const buildMediators = (arstotzkaConfig: ArstotzkaConfig, logger: Logger): { pgMediator?: StatefulMediator; ngMediator?: StatefulMediator } => {
  if (!arstotzkaConfig.enabled) {
    logger.warn({ msg: 'Arstotzka is disabled, no mediators will be created' });
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
  cleanupMode: CleanupMode;
}

export interface CreatePipelineArgs {
  outputFormat: string;
  stateSource: string;
  cleanupMode: CleanupMode;
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

    await manager.preCleanup(cleanupMode, state);

    await manager.createPgDump(outputFormat, false, pgMediator);

    await manager.postCleanup(cleanupMode, state);
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

    await manager.preCleanup(cleanupMode, state);

    const pgDumpFilePath = await manager.createPgDump(outputFormat, shouldResume, pgMediator);

    const ngDumpFilePath = await manager.createNgDump(outputFormat, pgDumpFilePath, shouldResume, shouldCollectInfo, ngMediator);

    const metadata = buildDumpMetadata(outputFormat, manager.timestamp, state);

    await manager.uploadDumpToS3(ngDumpFilePath, s3BucketName, metadata.name, s3Acl);

    if (dumpServerEndpoint !== undefined) {
      await manager.registerOnDumpServer({ dumpServerEndpoint, dumpServerHeaders }, { ...metadata, bucket: s3BucketName });
    }

    await manager.postCleanup(cleanupMode, state);

    await ngMediator?.updateAction({ status: ActionStatus.COMPLETED, metadata: { dumpServerPayload: { ...metadata, bucket: s3BucketName } } });
  } catch (error) {
    await ngMediator?.updateAction({ status: ActionStatus.FAILED, metadata: { error } });
    throw error;
  }
};
