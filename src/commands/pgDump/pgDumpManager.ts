import { existsSync } from 'fs';
import { rmdir } from 'fs/promises';
import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { AxiosInstance } from 'axios';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { PG_DUMP_DIR, SERVICES, WORKDIR } from '../../common/constants';
import { InvalidStateFileError, PgDumpError } from '../../common/errors';
import { Executable } from '../../common/types';
import { clearDirectory, createDirectory, fetchSequenceNumber, streamToString } from '../../common/util';
import { spawnChild } from '../../processes/spawner';
import { IConfig, ILogger, PgDumpConfig, PostgresConfig } from '../../common/interfaces';
import { CleanupMode } from '../common/types';
import { nameFormat } from '../common/helpers';

@injectable()
export class PgDumpManager {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private readonly globalCommandArgs: Record<Executable, string[]> = { pg_dump: [], 'planet-dump-ng': [] };

  private state: string | undefined;

  public constructor(
    @inject(SERVICES.LOGGER) public readonly logger: Logger,
    @inject(SERVICES.CONFIG) public readonly config: IConfig,
    @inject(SERVICES.HTTP_CLIENT) public readonly axios: AxiosInstance
  ) {
    this.processConfig(config);
  }

  public async createPgDump(stateSource: string, dumpNameFormat: string, cleanupMode: CleanupMode, mediator?: StatefulMediator): Promise<string> {
    await mediator?.reserveAccess();

    // get current state
    const state = await this.getState(stateSource);

    const pgDumpName = nameFormat(dumpNameFormat, state);
    const currentPgDumpDir = join(WORKDIR, state, PG_DUMP_DIR);
    const pgDumpOutputPath = join(currentPgDumpDir, pgDumpName);
    const metadata = { pgDumpName, pgDumpOutputPath };

    await mediator?.createAction({ state: parseInt(state), metadata });
    await mediator?.removeLock();

    // pre cleanup
    if (cleanupMode === 'pre-clean-others') {
      await clearDirectory(WORKDIR, [state]);
    }

    // prepare state environment
    if (existsSync(currentPgDumpDir)) {
      await rmdir(currentPgDumpDir, { recursive: true });
    }
    await createDirectory(currentPgDumpDir);

    // execute command
    await this.executePgDump(pgDumpOutputPath);

    // post cleanup
    if (cleanupMode === 'post-clean-others') {
      await clearDirectory(WORKDIR, [state]);
    }

    await mediator?.updateAction({ status: ActionStatus.COMPLETED });

    return pgDumpOutputPath;
  }

  public async getState(stateSource: string): Promise<string> {
    if (this.state !== undefined) {
      this.logger.debug({ msg: 'state is already defined on manager', state: this.state });
      return this.state;
    }

    if (!isNaN(parseInt(stateSource))) {
      this.state = stateSource;
      this.logger.info({ msg: 'state is set to numeric value', state: this.state });
      return this.state;
    }

    this.logger.info({ msg: 'getting current state number from remote source', stateSourceUrl: stateSource });

    const response = await this.axios.get<NodeJS.ReadStream>(stateSource, { responseType: 'stream' });
    const stateContent = await streamToString(response.data);
    this.state = this.fetchSequenceNumberSafely(stateContent);

    this.logger.info({ msg: 'state is set to fetched remote url state', state: this.state, stateSourceUrl: stateSource });

    return this.state;
  }

  public async commandWrapper(
    executable: Executable,
    commandArgs: string[],
    error: new (message?: string) => Error,
    command?: string
  ): Promise<void> {
    const globalArgs = this.globalCommandArgs[executable];
    const args = command !== undefined ? [command, ...globalArgs, ...commandArgs] : [...globalArgs, ...commandArgs];

    this.logger.info({ msg: 'executing command', executable, command, args });

    let childLogger: ILogger | undefined;
    if (globalArgs.includes('--verbose')) {
      childLogger = this.logger.child({ executable, command, args }, { level: 'debug' });
    }

    const { exitCode, stderr } = await spawnChild(executable, args, command, undefined, childLogger);

    if (exitCode !== 0) {
      this.logger.error({ msg: 'failure occurred during the execute of command', executable, command, args, executableExitCode: exitCode, stderr });
      throw new error(`an error occurred while running ${executable} with ${command ?? 'undefined'} command, exit code ${exitCode}`);
    }
  }

  private async executePgDump(pgDumpOutputPath: string): Promise<void> {
    this.logger.info({ msg: 'creating pg dump', pgDumpOutputPath });

    const executable: Executable = 'pg_dump';
    const args = ['--format=custom', `--file=${pgDumpOutputPath}`];

    await this.commandWrapper(executable, args, PgDumpError);
  }

  private fetchSequenceNumberSafely(content: string): string {
    try {
      return fetchSequenceNumber(content);
    } catch (error) {
      this.logger.error({ err: error, msg: 'failed to fetch sequence number out of the state file' });
      throw new InvalidStateFileError('could not fetch sequence number out of the state file');
    }
  }

  private processConfig(config: IConfig): void {
    const pgDumpGlobalArgs = this.globalCommandArgs.pg_dump;

    const pgDumpConfig = config.get<PgDumpConfig>('pgDump');
    if (pgDumpConfig.verbose) {
      pgDumpGlobalArgs.push('--verbose');
    }

    const postgresConfig = config.get<PostgresConfig>('postgres');
    if (postgresConfig.enableSslAuth) {
      const { cert, key, ca } = postgresConfig.sslPaths;

      pgDumpGlobalArgs.push(`sslcert=${cert}`);
      pgDumpGlobalArgs.push(`sslkey=${key}`);
      pgDumpGlobalArgs.push(`sslrootcert=${ca}`);
    }
  }
}
