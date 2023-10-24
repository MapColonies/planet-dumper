export type CleanupMode = 'none' | 'pre-clean-others' | 'post-clean-others';

export type ExtendedCleanupMode = CleanupMode | 'post-clean-workdir' | 'post-clean-all';

export interface GlobalArguments {
  outputFormat: string;
  stateSource: string;
  cleanupMode: CleanupMode | ExtendedCleanupMode;
}
