import { Arguments } from 'yargs';
import { CheckError } from '../common/errors';
import { ILogger } from '../common/interfaces';

export type CheckFunc<T> = (argv: Arguments<T>) => true;

export const check = <T>(check: CheckFunc<T>, logger?: ILogger): CheckFunc<T> => {
  const wrapper: CheckFunc<T> = (argv) => {
    try {
      return check(argv);
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
