import yargs from 'yargs/yargs';
import { Argv, CommandModule } from 'yargs';
import { FactoryFunction } from 'tsyringe';
import { CREATE_COMMAND_FACTORY } from './commands/create/create';
import { PG_DUMP_COMMAND_FACTORY } from './commands/pgDump/pgDumpFactory';

export const cliBuilderFactory: FactoryFunction<Argv> = (dependencyContainer) => {
  const args = yargs().env().usage('Usage: $0 <command> [options]').demandCommand(1, 'Please provide a command').help('h').alias('h', 'help');

  args.command(dependencyContainer.resolve<CommandModule>(PG_DUMP_COMMAND_FACTORY));
  args.command(dependencyContainer.resolve<CommandModule>(CREATE_COMMAND_FACTORY));

  return args;
};
