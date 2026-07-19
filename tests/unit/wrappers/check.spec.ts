import { describe, it, expect, vi } from 'vitest';
import type { Arguments } from 'yargs';
import { check } from '@src/wrappers/check';
import { CheckError } from '@common/errors';
import type { ILogger } from '@common/interfaces';
import type { CheckFunc } from '@src/wrappers/check';

const buildLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
const argv: Arguments<Record<string, unknown>> = { _: [], $0: 'planet-dumper' };

describe('check wrapper', () => {
  it('returns true when the wrapped check passes', () => {
    const passingCheck: CheckFunc<Record<string, unknown>> = () => true;

    expect(check(passingCheck)(argv)).toBe(true);
  });

  it('logs and rethrows when the wrapped check throws a CheckError', () => {
    const logger = buildLogger();
    const failingCheck: CheckFunc<Record<string, unknown>> = () => {
      throw new CheckError('bad argument', 'some-arg', 'some-value');
    };

    expect(() => check(failingCheck, logger)(argv)).toThrow(CheckError);
    expect(logger.error).toHaveBeenCalledWith({ msg: 'bad argument', argument: 'some-arg', received: 'some-value' });
  });

  it('rethrows without logging when the wrapped check throws a non-CheckError', () => {
    const logger = buildLogger();
    const failingCheck: CheckFunc<Record<string, unknown>> = () => {
      throw new Error('unexpected');
    };

    expect(() => check(failingCheck, logger)(argv)).toThrow('unexpected');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
