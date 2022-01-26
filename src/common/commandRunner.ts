import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import { PassThrough } from 'stream';
import { Logger } from '@map-colonies/js-logger';
import concatStream from 'concat-stream';
import { Executable } from '../common/types';
import { IConfig, PgDumpConfig, PostgresConfig } from './interfaces';

interface ExecuteReturn {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const readStream = async (stream: NodeJS.ReadableStream): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    stream.pipe(
      concatStream((result: Buffer) => {
        resolve(result.toString());
      }).on('error', reject)
    );
  });
};

export class CommandRunner {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private readonly globalCommandArgs: Record<Executable, string[]> = { pg_dump: [], 'planet-dump-ng': [] };

  public constructor(private readonly logger: Logger, private readonly config: IConfig) {
    this.processConfig(config);
  }

  public async run(executable: Executable, command?: string, commandArgs: string[] = []): Promise<ExecuteReturn> {
    const childProcess = this.createProcess(executable, command, commandArgs);

    childProcess.stdin.setDefaultEncoding('utf-8');

    const stderrClonedForLogging = childProcess.stderr.pipe(new PassThrough());
    const stderrClonedForResult = childProcess.stderr.pipe(new PassThrough());

    readline.createInterface(stderrClonedForLogging).on('line', (line) => {
      if (line.length > 0) {
        this.logger.info(line);
      }
    });

    const promise = new Promise<ExecuteReturn>((resolve, reject) => {
      childProcess.once('exit', (code) => {
        Promise.all([readStream(stderrClonedForResult), readStream(childProcess.stderr)])
          .then(([stdout, stderr]) => resolve({ exitCode: code, stdout, stderr }))
          .catch(reject);
      });
      childProcess.on('error', reject);
    });
    return promise;
  }

  private createProcess(executable: Executable, command?: string, commandArgs: string[] = []): ChildProcessWithoutNullStreams {
    const globalArgs = this.globalCommandArgs[executable];
    const args = command != undefined ? [command, ...globalArgs, ...commandArgs] : [...globalArgs, ...commandArgs];

    const prettyArgs = args.join(' ');
    this.logger.debug(`running command: ${executable} ${prettyArgs}`);

    return spawn(executable, args);
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
