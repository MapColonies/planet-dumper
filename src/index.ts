/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import 'reflect-metadata';
import './common/tracing';
import { hideBin } from 'yargs/helpers';
import { Logger } from '@map-colonies/js-logger';
import { ExitCodes, EXIT_CODE, ON_SIGNAL, SERVICES } from './common/constants';
import { getCli } from './cli';

const [cli, container] = getCli();
void cli
  .parseAsync(hideBin(process.argv))
  .catch((error: Error) => {
    let logFunction;
    if (container.isRegistered(SERVICES.LOGGER)) {
      const logger = container.resolve<Logger>(SERVICES.LOGGER);
      logFunction = logger.error.bind(logger);
    } else {
      logFunction = console.error;
    }

    logFunction({ msg: '😢 - failed initializing the server', err: error });
  })
  .finally(() => {
    const shutDown: () => Promise<void> = container.resolve(ON_SIGNAL);
    void shutDown().then(() => {
      const exitCode = container.isRegistered(EXIT_CODE) ? container.resolve<number>(EXIT_CODE) : ExitCodes.GENERAL_ERROR;
      process.exit(exitCode);
    });
  });
