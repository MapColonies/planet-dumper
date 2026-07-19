import { describe, it, expect } from 'vitest';
import type { Arguments } from 'yargs';
import { cronExpressionCheck, scheduleTargetOptionsCheck } from '@src/commands/schedule/checks';
import { CheckError } from '@common/errors';
import type { ScheduleArguments } from '@src/commands/schedule/scheduleFactory';

const buildArgv = (overrides: Partial<ScheduleArguments>): Arguments<ScheduleArguments> => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
  _: [],
  $0: 'planet-dumper',
  outputFormat: 'dump_{state}_{timestamp}.pbf',
  stateSource: '1',
  cleanupMode: 'none',
  s3Acl: 'private',
  dumpServerHeaders: [],
  resume: false,
  info: false,
  target: 'pg_dump',
  cronExpression: '* * * * *',
  runOnInit: false,
  ...overrides,
});

describe('schedule checks', () => {
  describe('#cronExpressionCheck', () => {
    it('accepts a valid cron expression', () => {
      expect(cronExpressionCheck(buildArgv({ cronExpression: '*/5 * * * *' }))).toBe(true);
    });

    it('rejects an invalid cron expression', () => {
      expect(() => cronExpressionCheck(buildArgv({ cronExpression: 'not-a-cron' }))).toThrow(CheckError);
    });
  });

  describe('#scheduleTargetOptionsCheck', () => {
    it('allows target "pg_dump" without s3 options', () => {
      expect(scheduleTargetOptionsCheck(buildArgv({ target: 'pg_dump' }))).toBe(true);
    });

    it('allows target "create" when s3 options are provided', () => {
      expect(scheduleTargetOptionsCheck(buildArgv({ target: 'create', s3Endpoint: 'https://s3.example.com', s3BucketName: 'bucket' }))).toBe(true);
    });

    it('rejects target "create" without s3Endpoint/s3BucketName', () => {
      expect(() => scheduleTargetOptionsCheck(buildArgv({ target: 'create' }))).toThrow(CheckError);
    });
  });
});
