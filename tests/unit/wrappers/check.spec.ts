import { describe, it, expect, vi } from 'vitest';
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

describe('check wrapper', () => {
  it('returns true when the wrapped check passes', () => {
    const passingCheck: CheckFunc<string> = () => true;

    expect(check(passingCheck)('value')).toBe(true);
  });

  it('logs and rethrows when the wrapped check throws a CheckError', () => {
    const logger = buildLogger();
    const failingCheck: CheckFunc<string> = () => {
      throw new CheckError('bad argument', 'some-arg', 'some-value');
    };

    expect(() => check(failingCheck, logger)('value')).toThrow(CheckError);
    expect(logger.error).toHaveBeenCalledWith({ msg: 'bad argument', argument: 'some-arg', received: 'some-value' });
  });

  it('rethrows without logging when the wrapped check throws a non-CheckError', () => {
    const logger = buildLogger();
    const failingCheck: CheckFunc<string> = () => {
      throw new Error('unexpected');
    };

    expect(() => check(failingCheck, logger)('value')).toThrow('unexpected');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
