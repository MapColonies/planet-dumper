/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import 'reflect-metadata';
import './common/tracing';
import { hideBin } from 'yargs/helpers';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { ExitCodes, EXIT_CODE, SERVICES } from './common/constants';
import { getCli } from './cli';
import { ShutdownHandler } from './common/shutdownHandler';

let depContainer: DependencyContainer | undefined;

const exitProcess = (): void => {
  const exitCode = depContainer?.isRegistered(EXIT_CODE) === true ? depContainer.resolve<number>(EXIT_CODE) : ExitCodes.GENERAL_ERROR;
  process.exit(exitCode);
};

void getCli()
  .then(async ([container, cli]) => {
    depContainer = container;
    await cli.parseAsync(hideBin(process.argv));
  })
  .catch((error: Error) => {
    const errorLogger =
      depContainer?.isRegistered(SERVICES.LOGGER) === true
        ? depContainer.resolve<Logger>(SERVICES.LOGGER).error.bind(depContainer.resolve<Logger>(SERVICES.LOGGER))
        : console.error;
    errorLogger({ msg: '😢 - failed initializing the server', err: error });
  })
  .finally(() => {
    if (depContainer?.isRegistered(ShutdownHandler) === true) {
      const shutdownHandler = depContainer.resolve(ShutdownHandler);
      void shutdownHandler.onShutdown().then(() => {
        exitProcess();
      });
    }
    exitProcess();
  });
