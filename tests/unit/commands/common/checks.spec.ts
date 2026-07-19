import { describe, it, expect } from 'vitest';
import type { Arguments } from 'yargs';
import { stateSourceCheck } from '@src/commands/common/checks';
import { CheckError } from '@common/errors';
import type { GlobalArguments } from '@src/commands/common/types';

const buildArgv = (stateSource: string): Arguments<GlobalArguments> => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
  _: [],
  $0: 'planet-dumper',
  stateSource,
  outputFormat: 'dump_{state}.pbf',
  cleanupMode: 'none',
});

describe('common checks', () => {
  describe('#stateSourceCheck', () => {
    it('accepts a numeric state source', () => {
      expect(stateSourceCheck(buildArgv('1'))).toBe(true);
    });

    it('accepts a valid web uri state source', () => {
      expect(stateSourceCheck(buildArgv('https://example.com/state.txt'))).toBe(true);
    });

    it('rejects a value that is neither numeric nor a valid web uri', () => {
      expect(() => stateSourceCheck(buildArgv('not-a-number-or-uri'))).toThrow(CheckError);
    });
  });
});
