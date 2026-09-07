import { join } from 'node:path';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import nock from 'nock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { nameFormat } from '@src/commands/common/helpers';
import { PgDumpError, InvalidStateFileError } from '@common/errors';
import { WORKDIR, PG_DUMP_DIR } from '@common/constants';
import { spawnChild } from '@common/spawner';
import { buildConfig, buildFsRepository } from '@tests/fixtures';
import type { FsRepository } from '@src/fsRepository/fsRepository';

const STATE_SERVER = 'https://state.example.com';

vi.mock('@common/spawner', () => ({
  spawnChild: vi.fn(),
}));

const spawnChildMock = vi.mocked(spawnChild);

const buildAxios = (): AxiosInstance => {
  const instance = axios.create();
  vi.spyOn(instance, 'get');
  return instance;
};

const buildManager = (fsRepository: FsRepository = buildFsRepository(), httpClient: AxiosInstance = buildAxios()) =>
  new PgDumpManager(
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnValue({ debug: vi.fn() }) } as never,
    buildConfig(),
    httpClient,
    fsRepository
  );

describe('PgDumpManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnChildMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Happy Path', () => {
    describe('#getState', () => {
      it('sets and returns state directly for a numeric state source, without any network call', async () => {
        const axios = buildAxios();
        const manager = buildManager(undefined, axios);

        await expect(manager.getState('42')).resolves.toBe('42');
        expect(manager.state).toBe('42');
        expect(axios.get).not.toHaveBeenCalled();
      });

      it('returns the already-resolved state without recomputing it', async () => {
        const axios = buildAxios();
        const manager = buildManager(undefined, axios);
        await manager.getState('1');

        await expect(manager.getState('some-other-source')).resolves.toBe('1');
        expect(axios.get).not.toHaveBeenCalled();
      });

      it('fetches and parses the sequence number from a remote state url', async () => {
        const scope = nock(STATE_SERVER).get('/state.txt').reply(200, 'sequenceNumber=007\ntimestamp=2024-01-01T00:00:00Z\n');
        const manager = buildManager(undefined, axios.create());

        await expect(manager.getState(`${STATE_SERVER}/state.txt`)).resolves.toBe('007');
        expect(manager.state).toBe('007');
        expect(scope.isDone()).toBe(true);
      });
    });

    describe('#createPgDump', () => {
      it('creates a fresh pg dump: prepares the directory, runs pg_dump, and collects its size', async () => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);
        await manager.getState('1');

        const path = await manager.createPgDump('dump_{state}_{timestamp}.pbf', false);

        const expectedName = nameFormat('dump_{state}_{timestamp}.pbf', manager.timestamp, '1');
        const expectedDir = join(WORKDIR, '1', PG_DUMP_DIR);
        expect(path).toBe(join(expectedDir, expectedName));
        expect(fsRepository.removeDirectory).toHaveBeenCalledWith(expectedDir);
        expect(fsRepository.createDirectoryIfNotAlreadyExists).toHaveBeenCalledWith(expectedDir);
        expect(spawnChildMock).toHaveBeenCalledOnce();
        expect(fsRepository.getFileSize).toHaveBeenCalledWith(path);
      });

      it('resumes from an existing pg dump without re-running pg_dump when one is found', async () => {
        const fsRepository = buildFsRepository();
        vi.mocked(fsRepository.listFilesInDirectory).mockResolvedValue(['/workdir/1/pg_dump/existing.dmp']);
        const manager = buildManager(fsRepository);
        await manager.getState('1');

        const path = await manager.createPgDump('dump_{state}_{timestamp}.pbf', true);

        expect(path).toBe('/workdir/1/pg_dump/existing.dmp');
        expect(spawnChildMock).not.toHaveBeenCalled();
        expect(fsRepository.removeDirectory).not.toHaveBeenCalled();
      });

      it('proceeds with a fresh dump when resume is requested but nothing exists yet', async () => {
        const fsRepository = buildFsRepository();
        vi.mocked(fsRepository.listFilesInDirectory).mockResolvedValue([]);
        const manager = buildManager(fsRepository);
        await manager.getState('1');

        await manager.createPgDump('dump_{state}_{timestamp}.pbf', true);

        expect(spawnChildMock).toHaveBeenCalledOnce();
      });

      it('drives the mediator through reserveAccess, createAction, removeLock, and a completed update', async () => {
        const manager = buildManager();
        await manager.getState('1');
        const mediator = new StatefulMediator({} as never);

        await manager.createPgDump('dump_{state}_{timestamp}.pbf', false, mediator);

        expect(mediator.reserveAccess).toHaveBeenCalledOnce();
        expect(mediator.createAction).toHaveBeenCalledWith(expect.objectContaining({ state: 1 }));
        expect(mediator.removeLock).toHaveBeenCalledOnce();
        expect(mediator.updateAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
      });
    });

    describe('#preCleanup / #postCleanup', () => {
      it('empties other states before the run only when mode is pre-clean-others', async () => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);

        await manager.preCleanup('pre-clean-others', '1');
        expect(fsRepository.emptyDirectory).toHaveBeenCalledWith(WORKDIR, ['1']);

        vi.mocked(fsRepository.emptyDirectory).mockClear();
        await manager.preCleanup('none', '1');
        expect(fsRepository.emptyDirectory).not.toHaveBeenCalled();
      });

      it('empties other states after the run only when mode is post-clean-others', async () => {
        const fsRepository = buildFsRepository();
        const manager = buildManager(fsRepository);

        await manager.postCleanup('post-clean-others', '1');
        expect(fsRepository.emptyDirectory).toHaveBeenCalledWith(WORKDIR, ['1']);

        vi.mocked(fsRepository.emptyDirectory).mockClear();
        await manager.postCleanup('post-clean-all', '1');
        expect(fsRepository.emptyDirectory).not.toHaveBeenCalled();
      });
    });

    describe('config-driven pg_dump arguments', () => {
      it('adds --verbose to the pg_dump invocation when pgDump.verbose is enabled', async () => {
        const config = buildConfig({ pgDump: { verbose: true }, 'pgDump.verbose': true });
        const manager = new PgDumpManager(
          { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnValue({ debug: vi.fn() }) } as never,
          config,
          buildAxios(),
          buildFsRepository()
        );
        await manager.getState('1');

        await manager.createPgDump('dump_{state}_{timestamp}.pbf', false);

        expect(spawnChildMock).toHaveBeenCalledWith(
          'pg_dump',
          expect.arrayContaining(['--verbose']),
          undefined,
          undefined,
          undefined,
          expect.anything()
        );
      });

      it('adds ssl args to the pg_dump invocation when postgres.enableSslAuth is enabled', async () => {
        const config = buildConfig({
          postgres: { enableSslAuth: true, sslPaths: { cert: 'cert.pem', key: 'key.pem', ca: 'ca.pem' } },
        });
        const manager = new PgDumpManager(
          { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnValue({ debug: vi.fn() }) } as never,
          config,
          buildAxios(),
          buildFsRepository()
        );
        await manager.getState('1');

        await manager.createPgDump('dump_{state}_{timestamp}.pbf', false);

        expect(spawnChildMock).toHaveBeenCalledWith(
          'pg_dump',
          expect.arrayContaining(['sslcert=cert.pem', 'sslkey=key.pem', 'sslrootcert=ca.pem']),
          undefined,
          undefined,
          undefined,
          undefined
        );
      });
    });
  });

  describe('Bad Path', () => {
    it('throws InvalidStateFileError when the fetched state content has no sequenceNumber', async () => {
      nock(STATE_SERVER).get('/state.txt').reply(200, 'not a valid state file\n');
      const manager = buildManager(undefined, axios.create());

      await expect(manager.getState(`${STATE_SERVER}/state.txt`)).rejects.toThrow(InvalidStateFileError);
    });
  });

  describe('Sad Path', () => {
    it('throws PgDumpError when pg_dump exits with a non-zero code', async () => {
      spawnChildMock.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'permission denied' } as never);
      const manager = buildManager();
      await manager.getState('1');

      await expect(manager.createPgDump('dump_{state}_{timestamp}.pbf', false)).rejects.toThrow(PgDumpError);
    });

    it('propagates a network failure when fetching remote state', async () => {
      const manager = buildManager(undefined, axios.create());

      await expect(manager.getState('http://127.0.0.1:1/state.txt')).rejects.toThrow('ECONNREFUSED');
    });
  });
});
