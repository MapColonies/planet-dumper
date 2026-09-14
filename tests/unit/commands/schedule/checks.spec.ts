import { describe, it, expect } from 'vitest';
import { cronExpressionCheck } from '@src/commands/schedule/checks';
import { CheckError } from '@common/errors';

describe('schedule checks', () => {
  describe('#cronExpressionCheck', () => {
    describe('Happy Path', () => {
      it('accepts a valid cron expression', () => {
        expect(cronExpressionCheck('*/5 * * * *')).toBe(true);
      });
    });

    describe('Bad Path', () => {
      it('rejects an invalid cron expression', () => {
        expect(() => cronExpressionCheck('not-a-cron')).toThrow(CheckError);
      });
    });
  });
});
