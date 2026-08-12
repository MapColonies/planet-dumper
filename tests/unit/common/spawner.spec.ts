import { describe, it, expect, vi } from 'vitest';
import { spawnChild, terminateChildren } from '@common/spawner';
import type { ILogger } from '@common/interfaces';

const NODE = process.execPath;

const buildLogger = (): ILogger => ({ debug: vi.fn() }) as unknown as ILogger;

describe('spawner', () => {
  describe('Happy Path', () => {
    describe('#spawnChild', () => {
      it('resolves with the exit code and captured stdout of a successful command', async () => {
        const result = await spawnChild(NODE, ['-e', 'process.stdout.write("hello")']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('hello');
      });

      it('prefixes args with the given command', async () => {
        const result = await spawnChild('/bin/echo', ['second'], 'first');

        expect(result.stdout).toBe('first second');
      });

      it('pipes stdout and stderr lines to the given logger when one is provided', async () => {
        const logger = buildLogger();

        await spawnChild(NODE, ['-e', 'console.log("out line"); console.error("err line")'], undefined, undefined, undefined, logger);

        expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ std: 'stdout', msg: 'out line' }));
        expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ std: 'stderr', msg: 'err line' }));
      });
    });

    describe('#terminateChildren', () => {
      it('returns empty results when there are no tracked children', () => {
        const result = terminateChildren();

        expect(result).toEqual({ preTermination: [], terminated: [] });
      });

      it('sends SIGINT to a running child and reports it as terminated', async () => {
        const childPromise = spawnChild(NODE, ['-e', 'setInterval(() => {}, 1000)']);

        const result = terminateChildren();

        expect(result.terminated).toHaveLength(1);
        expect(result.terminated[0]).toMatchObject({ executable: NODE });
        await expect(childPromise).rejects.toMatchObject({ signal: 'SIGINT' });
      });

      it('only terminates children matching the given executable filter', async () => {
        const matchingChildPromise = spawnChild(NODE, ['-e', 'setInterval(() => {}, 1000)']);
        const otherChildPromise = spawnChild('sleep', ['5']);

        const result = terminateChildren({ executable: NODE });

        expect(result.terminated).toHaveLength(1);
        expect(result.terminated[0]).toMatchObject({ executable: NODE });
        await expect(matchingChildPromise).rejects.toMatchObject({ signal: 'SIGINT' });

        terminateChildren({ executable: 'sleep' });
        await expect(otherChildPromise).rejects.toBeDefined();
      });

      it('skips children that are already killed', async () => {
        const childPromise = spawnChild(NODE, ['-e', 'setInterval(() => {}, 1000)']);
        terminateChildren();
        await expect(childPromise).rejects.toBeDefined();

        const secondResult = terminateChildren();

        expect(secondResult.terminated).toEqual([]);
      });
    });
  });

  describe('Sad Path', () => {
    it('rejects when the executable does not exist', async () => {
      await expect(spawnChild('this-executable-does-not-exist-xyz')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects (rather than resolving with a non-zero exitCode) when the process exits with a non-zero code', async () => {
      await expect(spawnChild(NODE, ['-e', 'process.exit(3)'])).rejects.toMatchObject({ exitCode: 3 });
    });
  });
});
