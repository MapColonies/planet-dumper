import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  streamToString,
  fetchSequenceNumber,
  createDirectoryIfNotAlreadyExists,
  removeDirectory,
  emptyDirectory,
  listFilesInDirectory,
  getFileSize,
} from '@common/util';

describe('util', () => {
  describe('#streamToString', () => {
    it('concatenates string chunks emitted by the stream', async () => {
      const stream = Readable.from(['hello ', 'world']) as unknown as NodeJS.ReadStream;

      await expect(streamToString(stream)).resolves.toBe('hello world');
    });

    it('concatenates buffer chunks emitted by the stream', async () => {
      const stream = Readable.from([Buffer.from('hello '), Buffer.from('world')]) as unknown as NodeJS.ReadStream;

      await expect(streamToString(stream)).resolves.toBe('hello world');
    });

    it('rejects when the stream emits an error', async () => {
      const stream = new Readable({
        read() {
          this.emit('error', new Error('boom'));
        },
      }) as unknown as NodeJS.ReadStream;

      await expect(streamToString(stream)).rejects.toThrow('boom');
    });
  });

  describe('#fetchSequenceNumber', () => {
    it('extracts the sequence number from a state file body', () => {
      const content = 'sequenceNumber=123\ntimestamp=2024-01-01T00:00:00Z\n';

      expect(fetchSequenceNumber(content)).toBe('123');
    });

    it('throws when the content has no sequenceNumber line', () => {
      expect(() => fetchSequenceNumber('timestamp=2024-01-01T00:00:00Z\n')).toThrow();
    });

    it('throws on empty content', () => {
      expect(() => fetchSequenceNumber('')).toThrow();
    });
  });

  describe('fs helpers', () => {
    let workdir: string;

    beforeEach(async () => {
      workdir = await mkdtemp(join(tmpdir(), 'planet-dumper-util-'));
    });

    afterEach(async () => {
      await rm(workdir, { recursive: true, force: true });
    });

    describe('#createDirectoryIfNotAlreadyExists', () => {
      it('creates a directory that does not exist yet', async () => {
        const dir = join(workdir, 'nested', 'dir');

        await createDirectoryIfNotAlreadyExists(dir);

        await expect(listFilesInDirectory(dir)).resolves.toEqual([]);
      });

      it('does not throw when the directory already exists', async () => {
        const dir = join(workdir, 'existing');
        await mkdir(dir);

        await expect(createDirectoryIfNotAlreadyExists(dir)).resolves.toBeUndefined();
      });
    });

    describe('#removeDirectory', () => {
      it('recursively removes an existing directory', async () => {
        const dir = join(workdir, 'to-remove');
        await mkdir(dir);
        await writeFile(join(dir, 'file.txt'), 'content');

        await removeDirectory(dir);

        await expect(listFilesInDirectory(dir)).resolves.toEqual([]);
      });

      it('does not throw when the directory does not exist', async () => {
        await expect(removeDirectory(join(workdir, 'never-existed'))).resolves.toBeUndefined();
      });
    });

    describe('#emptyDirectory', () => {
      it('removes all entries except ones in the whitelist', async () => {
        await writeFile(join(workdir, 'a.txt'), 'a');
        await writeFile(join(workdir, 'b.txt'), 'b');
        await mkdir(join(workdir, 'keep-me'));

        await emptyDirectory(workdir, ['keep-me']);

        await expect(listFilesInDirectory(workdir)).resolves.toEqual([]);
        await expect(listFilesInDirectory(join(workdir, 'keep-me'))).resolves.toEqual([]);
      });

      it('does not throw when the directory does not exist', async () => {
        await expect(emptyDirectory(join(workdir, 'missing'))).resolves.toBeUndefined();
      });
    });

    describe('#listFilesInDirectory', () => {
      it('returns an empty array for a missing directory', async () => {
        await expect(listFilesInDirectory(join(workdir, 'missing'))).resolves.toEqual([]);
      });

      it('lists only files, not sub-directories', async () => {
        await writeFile(join(workdir, 'file.txt'), 'content');
        await mkdir(join(workdir, 'subdir'));

        const files = await listFilesInDirectory(workdir);

        expect(files).toEqual([join(workdir, 'file.txt')]);
      });
    });

    describe('#getFileSize', () => {
      it('returns the size in bytes of the given file', async () => {
        const filePath = join(workdir, 'sized.txt');
        await writeFile(filePath, 'hello');

        await expect(getFileSize(filePath)).resolves.toBe(5);
      });
    });
  });
});
