import { join } from 'node:path';
import axios from 'axios';
import { S3Client } from '@aws-sdk/client-s3';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPgDumpPipeline, runCreatePipeline } from '@src/commands/common/pipelineRunner';
import type { PgDumpPipelineArgs, CreatePipelineArgs } from '@src/commands/common/pipelineRunner';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { CreateManager } from '@src/commands/create/createManager';
import { S3ClientWrapper } from '@src/s3client/s3Client';
import type { FsRepository } from '@src/fsRepository/fsRepository';
import { WORKDIR } from '@common/constants';
import { buildConfig, buildFsRepository, disabledArstotzkaConfig, enabledArstotzkaConfig } from '@tests/fixtures';

vi.mock('@map-colonies/arstotzka-mediator', () => {
  class StatefulMediator {
    public reserveAccess = vi.fn().mockResolvedValue(undefined);
    public removeLock = vi.fn().mockResolvedValue(undefined);
    public createAction = vi.fn().mockResolvedValue({ actionId: 'action-1' });
    public updateAction = vi.fn().mockResolvedValue(undefined);
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  return { StatefulMediator };
});

describe('pipelineRunner', () => {
  let logger: Awaited<ReturnType<typeof jsLogger>>;

  beforeEach(async () => {
    logger = await jsLogger({ enabled: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('#runPgDumpPipeline', () => {
    const buildManager = (): { manager: PgDumpManager; fsRepository: FsRepository } => {
      const fsRepository = buildFsRepository();
      return { manager: new PgDumpManager(logger, buildConfig(), axios.create(), fsRepository), fsRepository };
    };
    const buildArgs = (overrides: Partial<PgDumpPipelineArgs> = {}): PgDumpPipelineArgs => ({
      outputFormat: 'dump_{state}_{timestamp}.pbf',
      stateSource: '1',
      cleanupMode: 'none',
      ...overrides,
    });

    it('resolves state and creates the pg dump without cleanup by default', async () => {
      const { manager, fsRepository } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      const createPgDump = vi.spyOn(manager, 'createPgDump').mockResolvedValue('/workdir/1/pg_dump/dump.dmp');

      await runPgDumpPipeline(manager, buildArgs(), logger, disabledArstotzkaConfig);

      expect(createPgDump).toHaveBeenCalledWith('dump_{state}_{timestamp}.pbf', false, undefined);
      expect(vi.mocked(fsRepository.emptyDirectory)).not.toHaveBeenCalled();
    });

    it('cleans up other states before creating the pg dump when cleanupMode is pre-clean-others', async () => {
      const { manager, fsRepository } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      const createPgDump = vi.spyOn(manager, 'createPgDump').mockResolvedValue('/workdir/1/pg_dump/dump.dmp');

      await runPgDumpPipeline(manager, buildArgs({ cleanupMode: 'pre-clean-others' }), logger, disabledArstotzkaConfig);

      expect(vi.mocked(fsRepository.emptyDirectory)).toHaveBeenCalledWith(WORKDIR, ['1']);

      const [emptyDirectoryOrder] = vi.mocked(fsRepository.emptyDirectory).mock.invocationCallOrder;
      const [createPgDumpOrder] = createPgDump.mock.invocationCallOrder;
      if (emptyDirectoryOrder === undefined || createPgDumpOrder === undefined) {
        throw new Error('expected both emptyDirectory and createPgDump to have been called');
      }
      expect(emptyDirectoryOrder).toBeLessThan(createPgDumpOrder);
    });

    it('cleans up other states after creating the pg dump when cleanupMode is post-clean-others', async () => {
      const { manager, fsRepository } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      vi.spyOn(manager, 'createPgDump').mockResolvedValue('/workdir/1/pg_dump/dump.dmp');

      await runPgDumpPipeline(manager, buildArgs({ cleanupMode: 'post-clean-others' }), logger, disabledArstotzkaConfig);

      expect(vi.mocked(fsRepository.emptyDirectory)).toHaveBeenCalledWith(WORKDIR, ['1']);
    });

    it('propagates errors raised while creating the pg dump', async () => {
      const { manager } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      const failure = new Error('pg_dump failed');
      vi.spyOn(manager, 'createPgDump').mockRejectedValue(failure);

      await expect(runPgDumpPipeline(manager, buildArgs(), logger, disabledArstotzkaConfig)).rejects.toThrow(failure);
    });

    it('reserves access, creates the action, and reports completion via the mediator when arstotzka is enabled', async () => {
      const { manager } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      const createPgDump = vi.spyOn(manager, 'createPgDump').mockResolvedValue('/workdir/1/pg_dump/dump.dmp');

      await runPgDumpPipeline(manager, buildArgs(), logger, enabledArstotzkaConfig);

      expect(createPgDump).toHaveBeenCalledWith('dump_{state}_{timestamp}.pbf', false, expect.anything());
    });

    it('reports failure via the mediator when the pipeline throws and arstotzka is enabled', async () => {
      const { manager } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      const failure = new Error('pg_dump failed');
      vi.spyOn(manager, 'createPgDump').mockRejectedValue(failure);

      await expect(runPgDumpPipeline(manager, buildArgs(), logger, enabledArstotzkaConfig)).rejects.toThrow(failure);
    });
  });

  describe('#runCreatePipeline', () => {
    const buildManager = (): { manager: CreateManager; fsRepository: FsRepository } => {
      const fsRepository = buildFsRepository();
      const s3ClientWrapper = new S3ClientWrapper(logger, new S3Client({ region: 'us-east-1' }), buildConfig());
      return { manager: new CreateManager(logger, buildConfig(), axios.create(), fsRepository, s3ClientWrapper), fsRepository };
    };
    const buildArgs = (overrides: Partial<CreatePipelineArgs> = {}): CreatePipelineArgs => ({
      outputFormat: 'dump_{state}_{timestamp}.pbf',
      stateSource: '1',
      cleanupMode: 'none',
      resume: false,
      info: false,
      s3BucketName: 'bucket',
      s3Acl: 'private',
      dumpServerHeaders: [],
      ...overrides,
    });

    const stubHappyPath = (manager: CreateManager) => {
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      vi.spyOn(manager, 'createPgDump').mockResolvedValue('/workdir/1/pg_dump/dump.dmp');
      const createNgDump = vi.spyOn(manager, 'createNgDump').mockResolvedValue('/workdir/1/ng_dump/dump.pbf');
      const uploadDumpToS3 = vi.spyOn(manager, 'uploadDumpToS3').mockResolvedValue(undefined);
      const registerOnDumpServer = vi.spyOn(manager, 'registerOnDumpServer').mockResolvedValue(undefined);
      return { createNgDump, uploadDumpToS3, registerOnDumpServer };
    };

    it('runs the full pipeline and skips dump-server registration when no endpoint is configured', async () => {
      const { manager, fsRepository } = buildManager();
      const { createNgDump, uploadDumpToS3, registerOnDumpServer } = stubHappyPath(manager);

      await runCreatePipeline(manager, buildArgs(), logger, disabledArstotzkaConfig);

      expect(createNgDump).toHaveBeenCalledWith('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', false, false, undefined);
      expect(uploadDumpToS3).toHaveBeenCalledWith('/workdir/1/ng_dump/dump.pbf', 'bucket', expect.any(String), 'private');
      expect(registerOnDumpServer).not.toHaveBeenCalled();
      expect(vi.mocked(fsRepository.emptyDirectory)).not.toHaveBeenCalled();
    });

    it('registers the dump on the dump server when an endpoint is configured', async () => {
      const { manager } = buildManager();
      const { registerOnDumpServer } = stubHappyPath(manager);

      await runCreatePipeline(
        manager,
        buildArgs({ dumpServerEndpoint: 'https://dump-server.example.com', dumpServerHeaders: ['X-API-KEY=secret'] }),
        logger,
        disabledArstotzkaConfig
      );

      expect(registerOnDumpServer).toHaveBeenCalledWith(
        { dumpServerEndpoint: 'https://dump-server.example.com', dumpServerHeaders: ['X-API-KEY=secret'] },
        expect.objectContaining({ bucket: 'bucket' })
      );
    });

    it("empties only the current state's workdir when cleanupMode is post-clean-workdir", async () => {
      const { manager, fsRepository } = buildManager();
      stubHappyPath(manager);

      await runCreatePipeline(manager, buildArgs({ cleanupMode: 'post-clean-workdir' }), logger, disabledArstotzkaConfig);

      expect(vi.mocked(fsRepository.emptyDirectory)).toHaveBeenCalledWith(join(WORKDIR, '1'));
    });

    it("empties other states' workdirs when cleanupMode is post-clean-others", async () => {
      const { manager, fsRepository } = buildManager();
      stubHappyPath(manager);

      await runCreatePipeline(manager, buildArgs({ cleanupMode: 'post-clean-others' }), logger, disabledArstotzkaConfig);

      expect(vi.mocked(fsRepository.emptyDirectory)).toHaveBeenCalledWith(WORKDIR, ['1']);
    });

    it('empties the entire workdir when cleanupMode is post-clean-all', async () => {
      const { manager, fsRepository } = buildManager();
      stubHappyPath(manager);

      await runCreatePipeline(manager, buildArgs({ cleanupMode: 'post-clean-all' }), logger, disabledArstotzkaConfig);

      expect(vi.mocked(fsRepository.emptyDirectory)).toHaveBeenCalledWith(WORKDIR);
    });

    it('propagates errors raised anywhere in the pipeline', async () => {
      const { manager } = buildManager();
      vi.spyOn(manager, 'getState').mockResolvedValue('1');
      vi.spyOn(manager, 'createPgDump').mockResolvedValue('/workdir/1/pg_dump/dump.dmp');
      const failure = new Error('ng dump failed');
      vi.spyOn(manager, 'createNgDump').mockRejectedValue(failure);

      await expect(runCreatePipeline(manager, buildArgs(), logger, disabledArstotzkaConfig)).rejects.toThrow(failure);
    });
  });
});
