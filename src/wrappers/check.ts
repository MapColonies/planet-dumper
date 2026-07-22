import { CheckError } from '@common/errors';
import type { ILogger } from '@common/interfaces';

export type CheckFunc<T> = (value: T) => true;

export const check = <T>(check: CheckFunc<T>, logger?: ILogger): CheckFunc<T> => {
  const wrapper: CheckFunc<T> = (value) => {
    try {
      return check(value);
    } catch (err) {
      if (err instanceof CheckError) {
        logger?.error({
          msg: err.message,
          argument: err.argument,
          received: err.received,
        });
      }
      throw err;
    }
  };
  return wrapper;
};
