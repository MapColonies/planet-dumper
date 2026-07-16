export type CleanupMode = 'none' | 'pre-clean-others' | 'post-clean-others';

export type ExtendedCleanupMode = CleanupMode | 'post-clean-workdir' | 'post-clean-all';

export const PG_DUMP_CLEANUP_CHOICES: CleanupMode[] = ['none', 'pre-clean-others', 'post-clean-others'];

export const CREATE_CLEANUP_CHOICES: ExtendedCleanupMode[] = [
  'none',
  'pre-clean-others',
  'post-clean-others',
  'post-clean-workdir',
  'post-clean-all',
];

export interface GlobalArguments {
  outputFormat: string;
  stateSource: string;
  cleanupMode: CleanupMode | ExtendedCleanupMode;
}
