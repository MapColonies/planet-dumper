/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import 'reflect-metadata';
import { container } from 'tsyringe';
import { hideBin } from 'yargs/helpers';
import { ExitCodes, EXIT_CODE, ON_SIGNAL } from './common/constants';
import { getCli } from './cli';

void getCli()
  .parseAsync(hideBin(process.argv))
  .catch((error: Error) => {
    console.error('failed initializing the cli');
    console.error(error.message);
  })
  .finally(() => {
    const shutDown: () => Promise<void> = container.resolve(ON_SIGNAL);
    void shutDown().then(() => {
      const exitCode = container.isRegistered(EXIT_CODE) ? container.resolve<number>(EXIT_CODE) : ExitCodes.GENERAL_ERROR;
      process.exit(exitCode);
    });
  });
