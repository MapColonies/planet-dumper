import { join } from 'node:path';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import nock from 'nock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreateManager } from '@src/commands/create/createManager';
import { nameFormat } from '@src/commands/common/helpers';
import { BucketDoesNotExistError, HttpUpstreamResponseError, ObjectKeyAlreadyExistError, OsmiumError, PlanetDumpNgError } from '@common/errors';
import { WORKDIR, NG_DUMP_DIR } from '@common/constants';
import { spawnChild } from '@common/spawner';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { S3ClientWrapper } from '@src/s3client/s3Client';
import { buildConfig, buildFsRepository } from '@tests/fixtures';
import type { FsRepository } from '@src/fsRepository/fsRepository';

const DUMP_SERVER = 'https://dump-server.example.com';

vi.mock('@common/spawner', () => ({
  spawnChild: vi.fn(),
}));

vi.mock('node:fs', () => ({
  createReadStream: vi.fn().mockReturnValue({}),
}));

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

const spawnChildMock = vi.mocked(spawnChild);

const buildAxios = (): AxiosInstance => axios.create();

const buildS3Client = (): S3ClientWrapper =>
  ({
    validateExistance: vi.fn(),
    uploadStreamInParallel: vi.fn().mockResolvedValue(undefined),
  }) as unknown as S3ClientWrapper;

const buildManager = (
  fsRepository: FsRepository = buildFsRepository(),
  s3Client: S3ClientWrapper = buildS3Client(),
  config = buildConfig()
): CreateManager =>
  new CreateManager(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnValue({ debug: vi.fn() }) } as never,
    config,
    buildAxios(),
    fsRepository,
    s3Client
  );

describe('CreateManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnChildMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Happy Path', () => {
    describe('#createNgDump', () => {
      it('creates a fresh ng dump: prepares the directory, empties it, runs planet-dump-ng, and collects its size', async () => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);
        await manager.getState('1');

        const path = await manager.createNgDump('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', false, false);

        const expectedName = nameFormat('dump_{state}_{timestamp}.pbf', manager.timestamp, '1');
        const expectedDir = join(WORKDIR, '1', NG_DUMP_DIR);
        expect(path).toBe(join(expectedDir, expectedName));
        expect(fsRepository.createDirectoryIfNotAlreadyExists).toHaveBeenCalledWith(expectedDir);
        expect(fsRepository.emptyDirectory).toHaveBeenCalledWith(expectedDir);
        expect(spawnChildMock).toHaveBeenCalledWith(
          'planet-dump-ng',
          expect.arrayContaining([`--dump-file=/workdir/1/pg_dump/dump.dmp`, expect.stringContaining('--pbf=')]),
          undefined,
          expectedDir,
          undefined,
          undefined
        );
        expect(fsRepository.getFileSize).toHaveBeenCalledWith(path);
      });

      it('does not empty the ng dump directory when resuming', async () => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);
        await manager.getState('1');

        await manager.createNgDump('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', true, false);

        expect(fsRepository.emptyDirectory).not.toHaveBeenCalled();
        expect(spawnChildMock).toHaveBeenCalledWith(
          'planet-dump-ng',
          expect.arrayContaining(['--resume']),
          undefined,
          expect.any(String),
          undefined,
          undefined
        );
      });

      it('collects osmium info and attaches it to the metadata when shouldCollectInfo is true', async () => {
        spawnChildMock.mockResolvedValue({ exitCode: 0, stdout: '{"num_nodes":1}', stderr: '' } as never);
        const manager = buildManager();
        await manager.getState('1');

        await manager.createNgDump('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', false, true);

        expect(spawnChildMock).toHaveBeenCalledWith(
          'osmium',
          expect.arrayContaining(['--input-format', 'pbf', '--extended', '--json']),
          'fileinfo',
          undefined,
          undefined,
          undefined
        );
      });

      it('drives the mediator through reserveAccess, createAction, removeLock, and an update carrying the metadata', async () => {
        const manager = buildManager();
        await manager.getState('1');
        const mediator = new StatefulMediator({} as never);

        await manager.createNgDump('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', false, false, mediator);

        expect(mediator.reserveAccess).toHaveBeenCalledOnce();
        expect(mediator.createAction).toHaveBeenCalledWith(expect.objectContaining({ state: 1 }));
        expect(mediator.removeLock).toHaveBeenCalledOnce();
        expect(mediator.updateAction).toHaveBeenCalledWith(
          expect.objectContaining({ metadata: expect.objectContaining({ ngDumpName: expect.any(String) }) })
        );
      });
    });

    describe('#uploadDumpToS3', () => {
      it('uploads the file once the bucket exists and the key is free', async () => {
        const s3Client = buildS3Client();
        vi.mocked(s3Client.validateExistance).mockImplementation(async (type) => Promise.resolve(type === 'bucket'));
        const manager = buildManager(undefined, s3Client);

        await manager.uploadDumpToS3('/workdir/1/ng_dump/dump.pbf', 'bucket', 'key', 'private');

        expect(s3Client.uploadStreamInParallel).toHaveBeenCalledWith('bucket', 'key', expect.anything(), 'private');
      });
    });

    describe('#registerOnDumpServer', () => {
      it('posts the dump metadata to the configured dump server, forwarding the configured headers', async () => {
        const scope = nock(DUMP_SERVER, { reqheaders: { 'x-api-key': 'secret' } })
          .post('/dumps', (body: Record<string, unknown>) => body.name === 'dump.pbf' && body.bucket === 'bucket')
          .reply(201, 'ok');
        const manager = buildManager();

        await manager.registerOnDumpServer(
          { dumpServerEndpoint: DUMP_SERVER, dumpServerHeaders: ['X-API-KEY=secret'] },
          { name: 'dump.pbf', bucket: 'bucket', timestamp: new Date(), sequenceNumber: 1 }
        );

        expect(scope.isDone()).toBe(true);
      });
    });

    describe('#postCleanup', () => {
      it.each([
        ['post-clean-workdir', join(WORKDIR, '1')],
        ['post-clean-others', WORKDIR],
        ['post-clean-all', WORKDIR],
      ] as const)('empties the workdir accordingly when mode is %s', async (mode, expectedFirstArg) => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);

        await manager.postCleanup(mode, '1');

        expect(fsRepository.emptyDirectory).toHaveBeenCalledWith(expectedFirstArg, ...(mode === 'post-clean-others' ? [['1']] : []));
      });

      it.each(['none', 'pre-clean-others'] as const)('does nothing when mode is %s', async (mode) => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);

        await manager.postCleanup(mode, '1');

        expect(fsRepository.emptyDirectory).not.toHaveBeenCalled();
      });
    });

    describe('config-driven arguments', () => {
      it('adds --max-concurrency to the planet-dump-ng invocation when ngDump.maxConcurrency is set', async () => {
        const config = buildConfig({ ngDump: { maxConcurrency: 4 }, osmium: {} });
        const manager = buildManager(undefined, undefined, config);
        await manager.getState('1');

        await manager.createNgDump('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', false, false);

        expect(spawnChildMock).toHaveBeenCalledWith(
          'planet-dump-ng',
          expect.arrayContaining(['--max-concurrency=4']),
          undefined,
          expect.any(String),
          undefined,
          undefined
        );
      });

      it('adds --progress or --no-progress and --verbose to the osmium invocation based on config', async () => {
        const config = buildConfig({ osmium: { verbose: true, progress: true }, ngDump: {} });
        const manager = buildManager(undefined, undefined, config);
        await manager.getState('1');

        await manager.executeOsmium('/workdir/1/ng_dump/dump.pbf');

        expect(spawnChildMock).toHaveBeenCalledWith(
          'osmium',
          expect.arrayContaining(['--verbose', '--progress']),
          'fileinfo',
          undefined,
          undefined,
          undefined
        );
      });
    });
  });

  describe('Bad Path', () => {
    it('throws BucketDoesNotExistError when the target bucket does not exist', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.validateExistance).mockResolvedValue(false);
      const manager = buildManager(undefined, s3Client);

      await expect(manager.uploadDumpToS3('/workdir/1/ng_dump/dump.pbf', 'missing-bucket', 'key', 'private')).rejects.toThrow(
        BucketDoesNotExistError
      );
      expect(s3Client.uploadStreamInParallel).not.toHaveBeenCalled();
    });

    it('throws ObjectKeyAlreadyExistError when the target key already exists', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.validateExistance).mockResolvedValue(true);
      const manager = buildManager(undefined, s3Client);

      await expect(manager.uploadDumpToS3('/workdir/1/ng_dump/dump.pbf', 'bucket', 'existing-key', 'private')).rejects.toThrow(
        ObjectKeyAlreadyExistError
      );
      expect(s3Client.uploadStreamInParallel).not.toHaveBeenCalled();
    });
  });

  describe('Sad Path', () => {
    it('throws PlanetDumpNgError when planet-dump-ng exits with a non-zero code', async () => {
      spawnChildMock.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'disk full' } as never);
      const manager = buildManager();
      await manager.getState('1');

      await expect(manager.createNgDump('dump_{state}_{timestamp}.pbf', '/workdir/1/pg_dump/dump.dmp', false, false)).rejects.toThrow(
        PlanetDumpNgError
      );
    });

    it('throws OsmiumError when osmium exits with a non-zero code', async () => {
      spawnChildMock.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'corrupt pbf' } as never);
      const manager = buildManager();
      await manager.getState('1');

      await expect(manager.executeOsmium('/workdir/1/ng_dump/dump.pbf')).rejects.toThrow(OsmiumError);
    });

    it('propagates the underlying error when the parallel S3 upload fails', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.validateExistance).mockResolvedValue(false).mockResolvedValueOnce(true);
      vi.mocked(s3Client.uploadStreamInParallel).mockRejectedValue(new Error('network error'));
      const manager = buildManager(undefined, s3Client);

      await expect(manager.uploadDumpToS3('/workdir/1/ng_dump/dump.pbf', 'bucket', 'key', 'private')).rejects.toThrow('network error');
    });

    it('throws HttpUpstreamResponseError when the dump server responds with an error status', async () => {
      nock(DUMP_SERVER).post('/dumps').reply(500, { message: 'internal error' });
      const manager = buildManager();

      await expect(
        manager.registerOnDumpServer(
          { dumpServerEndpoint: DUMP_SERVER, dumpServerHeaders: [] },
          { name: 'dump.pbf', bucket: 'bucket', timestamp: new Date(), sequenceNumber: 1 }
        )
      ).rejects.toThrow(HttpUpstreamResponseError);
    });
  });
});
