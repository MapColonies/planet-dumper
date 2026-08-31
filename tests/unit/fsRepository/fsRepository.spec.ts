import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FsRepository } from '@src/fsRepository/fsRepository';

describe('FsRepository', () => {
  let workdir: string;
  let fsRepository: FsRepository;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'planet-dumper-fs-repository-'));
    fsRepository = new FsRepository();
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe('#createDirectoryIfNotAlreadyExists', () => {
    it('creates a directory that does not exist yet', async () => {
      const dir = join(workdir, 'nested', 'dir');

      await fsRepository.createDirectoryIfNotAlreadyExists(dir);

      await expect(fsRepository.listFilesInDirectory(dir)).resolves.toEqual([]);
    });

    it('does not throw when the directory already exists', async () => {
      const dir = join(workdir, 'existing');
      await mkdir(dir);

      await expect(fsRepository.createDirectoryIfNotAlreadyExists(dir)).resolves.toBeUndefined();
    });
  });

  describe('#removeDirectory', () => {
    it('recursively removes an existing directory', async () => {
      const dir = join(workdir, 'to-remove');
      await mkdir(dir);
      await writeFile(join(dir, 'file.txt'), 'content');

      await fsRepository.removeDirectory(dir);

      await expect(fsRepository.listFilesInDirectory(dir)).resolves.toEqual([]);
    });

    it('does not throw when the directory does not exist', async () => {
      await expect(fsRepository.removeDirectory(join(workdir, 'never-existed'))).resolves.toBeUndefined();
    });
  });

  describe('#emptyDirectory', () => {
    it('removes all entries except ones in the whitelist', async () => {
      await writeFile(join(workdir, 'a.txt'), 'a');
      await writeFile(join(workdir, 'b.txt'), 'b');
      await mkdir(join(workdir, 'keep-me'));

      await fsRepository.emptyDirectory(workdir, ['keep-me']);

      await expect(fsRepository.listFilesInDirectory(workdir)).resolves.toEqual([]);
      await expect(fsRepository.listFilesInDirectory(join(workdir, 'keep-me'))).resolves.toEqual([]);
    });

    it('does not throw when the directory does not exist', async () => {
      await expect(fsRepository.emptyDirectory(join(workdir, 'missing'))).resolves.toBeUndefined();
    });
  });

  describe('#listFilesInDirectory', () => {
    it('returns an empty array for a missing directory', async () => {
      await expect(fsRepository.listFilesInDirectory(join(workdir, 'missing'))).resolves.toEqual([]);
    });

    it('lists only files, not sub-directories', async () => {
      await writeFile(join(workdir, 'file.txt'), 'content');
      await mkdir(join(workdir, 'subdir'));

      const files = await fsRepository.listFilesInDirectory(workdir);

      expect(files).toEqual([join(workdir, 'file.txt')]);
    });
  });

  describe('#getFileSize', () => {
    it('returns the size in bytes of the given file', async () => {
      const filePath = join(workdir, 'sized.txt');
      await writeFile(filePath, 'hello');

      await expect(fsRepository.getFileSize(filePath)).resolves.toBe(5);
    });
  });

  describe('#createFileReadStream', () => {
    it('streams the full content of the given file', async () => {
      const filePath = join(workdir, 'streamed.txt');
      await writeFile(filePath, 'hello stream');

      const stream = fsRepository.createFileReadStream(filePath);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }

      expect(Buffer.concat(chunks).toString()).toBe('hello stream');
    });
  });
});
