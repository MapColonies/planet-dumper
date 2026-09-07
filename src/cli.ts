import type { Argv } from 'yargs';
import type { DependencyContainer } from 'tsyringe';
import { CLI_BUILDER } from '@common/constants';
import type { RegisterOptions } from './containerConfig';
import { registerExternalValues } from './containerConfig';

export const getCli = async (registerOptions?: RegisterOptions): Promise<[DependencyContainer, Argv]> => {
  const container = await registerExternalValues(registerOptions);
  const argv = container.resolve<Argv>(CLI_BUILDER);
  return [container, argv];
};
