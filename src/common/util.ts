import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir, readdir, rmdir } from 'fs/promises';
import { NOT_FOUND_INDEX, SEQUENCE_NUMBER_REGEX } from './constants';

export const streamToString = async (stream: NodeJS.ReadStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    stream.setEncoding('utf8');
    let data = '';
    stream.on('data', (chunk) => (data += chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(data));
  });
};

export const fetchSequenceNumber = (content: string): string => {
  const matchResult = content.match(SEQUENCE_NUMBER_REGEX);
  if (matchResult === null || matchResult.length === 0) {
    throw new Error();
  }

  return matchResult[0].split('=')[1];
};

export const createDirectory = async (dir: string): Promise<void> => {
  if (existsSync(dir)) {
    return;
  }
  await mkdir(dir, { recursive: true });
};

export const clearDirectory = async (dir: string, whiteList: string[] = []): Promise<void> => {
  for await (const currentDir of await readdir(dir)) {
    if (whiteList.indexOf(currentDir) !== NOT_FOUND_INDEX) {
      continue;
    }
    await rmdir(join(dir, currentDir), { recursive: true });
  }
};
