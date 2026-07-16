import type { Argv } from 'yargs';
import { DEFAULT_STATE } from '@common/constants';
import type { CleanupMode, ExtendedCleanupMode, GlobalArguments } from './types';

export interface CreateOnlyArguments {
  s3Endpoint?: string;
  s3BucketName?: string;
  s3Acl: string;
  dumpServerEndpoint?: string;
  dumpServerHeaders: string[];
  resume: boolean;
  info: boolean;
}

export const addOutputAndStateOptions = <T extends GlobalArguments>(yargs: Argv<T>): Argv<T> => {
  const result = yargs
    .option('outputFormat', {
      alias: ['o', 'output-format'],
      description: 'The resulting output name format, example: prefix_{state}_{timestamp}_suffix.pbf',
      nargs: 1,
      type: 'string',
      demandOption: true,
    })
    .option('stateSource', {
      alias: ['s'],
      description: 'Determines state seqeunce number to source',
      nargs: 1,
      type: 'string',
      default: DEFAULT_STATE.toString(),
    });
  return result as unknown as Argv<T>;
};

export const addCleanupModeOption = <T extends GlobalArguments>(yargs: Argv<T>, choices: (CleanupMode | ExtendedCleanupMode)[]): Argv<T> => {
  const result = yargs.option('cleanupMode', {
    alias: 'c',
    describe: 'the command execution cleanup mode',
    choices,
    nargs: 1,
    type: 'string',
    default: 'none',
  });
  return result as unknown as Argv<T>;
};

export const addCreateOnlyOptions = <T extends CreateOnlyArguments>(yargs: Argv<T>): Argv<T> => {
  const result = yargs
    .option('s3Endpoint', { alias: ['e', 's3-endpoint'], describe: 'The s3 endpoint', nargs: 1, type: 'string' })
    .option('s3BucketName', {
      alias: ['b', 's3-bucket-name'],
      describe: 'The bucket the resulting dump will be uploaded to',
      nargs: 1,
      type: 'string',
    })
    .option('s3Acl', {
      alias: ['a', 's3-acl'],
      describe: 'The canned acl policy for uploaded objects',
      choices: ['authenticated-read', 'private', 'public-read', 'public-read-write'],
      default: 'private',
    })
    .option('dumpServerEndpoint', {
      alias: ['d', 'dump-server-endpoint'],
      description: 'The endpoint of the dump-server',
      nargs: 1,
      type: 'string',
    })
    .option('dumpServerHeaders', {
      alias: ['H', 'dump-server-headers'],
      description: 'The headers to attach to the dump-server request',
      array: true,
      type: 'string',
      default: [] as string[],
    })
    .option('resume', {
      alias: ['r', 'resume'],
      describe: 'resume already existing dump state',
      type: 'boolean',
      default: false,
    })
    .option('info', {
      alias: ['i', 'info'],
      describe: 'collect info on the resulted dump',
      type: 'boolean',
      default: false,
    });
  return result as unknown as Argv<T>;
};
