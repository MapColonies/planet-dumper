import { Argv } from 'yargs';
import { DependencyContainer } from 'tsyringe';
import { registerExternalValues, RegisterOptions } from './containerConfig';
import { CLI_BUILDER } from './common/constants';

export const getCli = async (registerOptions?: RegisterOptions): Promise<[DependencyContainer, Argv]> => {
  const container = await registerExternalValues(registerOptions);
  const argv = container.resolve<Argv>(CLI_BUILDER);
  return [container, argv];
};
