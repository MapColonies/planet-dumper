import { describe, it, expect } from 'vitest';
import { stateSourceCheck } from '@src/commands/common/checks';
import { CheckError } from '@common/errors';

describe('common checks', () => {
  describe('#stateSourceCheck', () => {
    describe('Happy Path', () => {
      it('accepts a numeric state source', () => {
        expect(stateSourceCheck('1')).toBe(true);
      });

      it('accepts a valid web uri state source', () => {
        expect(stateSourceCheck('https://example.com/state.txt')).toBe(true);
      });
    });

    describe('Bad Path', () => {
      it('rejects a value that is neither numeric nor a valid web uri', () => {
        expect(() => stateSourceCheck('not-a-number-or-uri')).toThrow(CheckError);
      });
    });
  });
});
