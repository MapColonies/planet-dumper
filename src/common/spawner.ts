import * as readline from 'readline';
import { PassThrough } from 'stream';
import execa, { ExecaChildProcess } from 'execa';
import { ILogger } from '../common/interfaces';
import { NOT_FOUND_INDEX } from '../common/constants';

const children: { executable: string; childProcess: ExecaChildProcess }[] = [];

interface SubTerminationResult {
  executable: string;
  pid?: number;
  killed?: boolean;
}

export interface TerminationResult {
  preTermination: SubTerminationResult[];
  terminated: SubTerminationResult[];
}

export const spawnChild = async (
  executable: string,
  commandArgs: string[] = [],
  command?: string,
  cwd?: string,
  envOptions?: NodeJS.ProcessEnv,
  logger?: ILogger
): Promise<ExecaChildProcess> => {
  const spawnedChild = execa(executable, command !== undefined ? [command, ...commandArgs] : commandArgs, {
    env: { ...process.env, ...envOptions },
    encoding: 'utf-8',
    cwd,
  });

  const drain = (): void => {
    const index = children.findIndex((child) => child.childProcess.pid === spawnedChild.pid);
    if (index !== NOT_FOUND_INDEX) {
      children.splice(index, 1);
    }
  };

  children.push({ executable, childProcess: spawnedChild });

  if (logger !== undefined) {
    const stdoutPipedForLogging = spawnedChild.stdout?.pipe(new PassThrough());
    const stderrPipedForLogging = spawnedChild.stderr?.pipe(new PassThrough());

    if (stdoutPipedForLogging) {
      readline.createInterface(stdoutPipedForLogging).on('line', (line) => {
        if (line.length > 0) {
          logger.debug({ pid: spawnedChild.pid, executable, command, std: 'stdout', msg: line });
        }
      });
    }

    if (stderrPipedForLogging) {
      readline.createInterface(stderrPipedForLogging).on('line', (line) => {
        if (line.length > 0) {
          logger.debug({ pid: spawnedChild.pid, executable, command, std: 'stderr', msg: line });
        }
      });
    }
  }

  await spawnedChild.once('exit', drain);
  await spawnedChild.once('error', drain);

  return spawnedChild;
};

export const terminateChildren = (options?: { executable?: string; forceKillAfterTimeout?: number }): TerminationResult => {
  const result: TerminationResult = {
    preTermination: children.map((c) => ({ executable: c.executable, pid: c.childProcess.pid, killed: c.childProcess.killed })),
    terminated: [],
  };

  const { executable, forceKillAfterTimeout } = options ?? {};

  for (const child of children) {
    if (executable !== undefined && (child.executable !== executable || child.childProcess.killed)) {
      continue;
    }

    result.terminated.push({ executable: child.executable, pid: child.childProcess.pid });

    child.childProcess.stdin?.end();
    child.childProcess.kill('SIGINT', { forceKillAfterTimeout });
  }

  return result;
};
