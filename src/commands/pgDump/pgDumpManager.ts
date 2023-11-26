import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { AxiosInstance } from 'axios';
import { StatefulMediator } from '@map-colonies/arstotzka-mediator';
import { ActionStatus } from '@map-colonies/arstotzka-common';
import { EMPTY_STRING, PG_DUMP_DIR, SERVICES, WORKDIR } from '../../common/constants';
import { InvalidStateFileError, PgDumpError } from '../../common/errors';
import { Executable } from '../../common/types';
import {
  createDirectoryIfNotAlreadyExists,
  fetchSequenceNumber,
  getFileSize,
  listFilesInDirectory,
  removeDirectory,
  streamToString,
} from '../../common/util';
import { spawnChild } from '../../common/spawner';
import { IConfig, ILogger, PgDumpConfig, PostgresConfig } from '../../common/interfaces';
import { nameFormat } from '../common/helpers';

@injectable()
export class PgDumpManager {
  public state = EMPTY_STRING;

  // eslint-disable-next-line @typescript-eslint/naming-convention
  protected readonly globalCommandArgs: Record<Executable, string[]> = { pg_dump: [], 'planet-dump-ng': [], osmium: [] };

  public constructor(
    @inject(SERVICES.LOGGER) public readonly logger: Logger,
    @inject(SERVICES.CONFIG) public readonly config: IConfig,
    @inject(SERVICES.HTTP_CLIENT) public readonly axios: AxiosInstance
  ) {
    this.processConfig(config);
  }

  public async createPgDump(outputFormat: string, shouldResume: boolean, mediator?: StatefulMediator): Promise<string> {
    const currentPgDumpDir = join(WORKDIR, this.state, PG_DUMP_DIR);

    // resume from existing pg dump if exists
    if (shouldResume) {
      const existingPgDumps = await listFilesInDirectory(currentPgDumpDir);

      if (existingPgDumps.length > 0) {
        const pgDumpFilePath = existingPgDumps[0];
        this.logger.info({ msg: 'resuming from an existing pg dump', pgDumpFilePath, pgDumpDirList: existingPgDumps });
        return pgDumpFilePath;
      }
    }

    await mediator?.reserveAccess();

    const pgDumpName = nameFormat(outputFormat, this.state);
    const pgDumpOutputPath = join(currentPgDumpDir, pgDumpName);
    const metadata = { pgDumpName, pgDumpOutputPath };

    await mediator?.createAction({ state: parseInt(this.state), metadata });
    await mediator?.removeLock();

    // prepare state environment
    await removeDirectory(currentPgDumpDir);
    await createDirectoryIfNotAlreadyExists(currentPgDumpDir);

    // execute command
    await this.executePgDump(pgDumpOutputPath);

    // collect metadata
    const size = await getFileSize(pgDumpOutputPath);

    await mediator?.updateAction({ status: ActionStatus.COMPLETED, metadata: { size } });

    return pgDumpOutputPath;
  }

  public async getState(stateSource: string): Promise<string> {
    if (this.state !== EMPTY_STRING) {
      this.logger.debug({ msg: 'state is already defined on manager', state: this.state });
      return this.state;
    }

    if (!isNaN(parseInt(stateSource))) {
      this.state = stateSource.toString();
      this.logger.info({ msg: 'state is set to static value', state: this.state });
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
    args: string[],
    error: new (message?: string) => Error = Error,
    command?: string,
    cwd?: string,
    verbose?: boolean
  ): Promise<string> {
    this.logger.info({ msg: 'executing command', executable, command, args, cwd });

    let childLogger: ILogger | undefined;
    if (verbose === true) {
      childLogger = this.logger.child({ executable, command, args }, { level: 'debug' });
    }

    const { exitCode, stderr, stdout } = await spawnChild(executable, args, command, cwd, undefined, childLogger);

    if (exitCode !== 0) {
      this.logger.error({ msg: 'failure occurred during the execute of command', executable, command, args, executableExitCode: exitCode, stderr });
      throw new error(`an error occurred while running ${executable} with ${command ?? 'undefined'} command, exit code ${exitCode}`);
    }

    return stdout;
  }

  protected processConfig(config: IConfig): void {
    const pgDumpConfig = config.get<PgDumpConfig>('pgDump');

    const pgDumpGlobalArgs = this.globalCommandArgs.pg_dump;

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

  private async executePgDump(pgDumpOutputPath: string): Promise<void> {
    this.logger.info({ msg: 'creating pg dump', pgDumpOutputPath });

    const executable: Executable = 'pg_dump';
    const globalArgs = this.globalCommandArgs[executable];
    const args = [...globalArgs, '--format=custom', `--file=${pgDumpOutputPath}`];
    const isVerbose = this.config.get<boolean>('pgDump.verbose');

    await this.commandWrapper(executable, args, PgDumpError, undefined, undefined, isVerbose);
  }

  private fetchSequenceNumberSafely(content: string): string {
    try {
      return fetchSequenceNumber(content);
    } catch (error) {
      this.logger.error({ err: error, msg: 'failed to fetch sequence number out of the state file' });
      throw new InvalidStateFileError('could not fetch sequence number out of the state file');
    }
  }
}
