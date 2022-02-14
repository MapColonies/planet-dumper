import yargs from 'yargs/yargs';
import { Argv } from 'yargs';
import { FactoryFunction } from 'tsyringe';
import { CreateCommand } from './commands/create/create';

export const cliBuilderFactory: FactoryFunction<Argv> = (dependencyContainer) => {
  const args = yargs().env().usage('Usage: $0 <command> [options]').demandCommand(1, 'Please provide a command').help('h').alias('h', 'help');

  args.command(dependencyContainer.resolve(CreateCommand));

  return args;
};
