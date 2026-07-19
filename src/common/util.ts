import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import { NOT_FOUND_INDEX, SEQUENCE_NUMBER_REGEX } from './constants';

export const streamToString = async (stream: NodeJS.ReadStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    stream.setEncoding('utf8');
    let data = '';
    stream.on('data', (chunk: Buffer | string) => (data += chunk.toString()));
    stream.on('error', reject);
    stream.on('end', () => resolve(data));
  });
};

export const fetchSequenceNumber = (content: string): string => {
  const [match] = content.match(SEQUENCE_NUMBER_REGEX) ?? [];
  const sequenceNumber = match?.split('=')[1];

  if (sequenceNumber === undefined) {
    throw new Error();
  }

  return sequenceNumber;
};

export const createDirectoryIfNotAlreadyExists = async (dir: string): Promise<void> => {
  if (existsSync(dir)) {
    return;
  }
  await mkdir(dir, { recursive: true });
};

export const removeDirectory = async (dir: string): Promise<void> => {
  if (!existsSync(dir)) {
    return;
  }
  await rm(dir, { recursive: true });
};

export const emptyDirectory = async (dir: string, whiteList: string[] = []): Promise<void> => {
  if (!existsSync(dir)) {
    return;
  }

  for (const item of await readdir(dir)) {
    if (whiteList.indexOf(item) !== NOT_FOUND_INDEX) {
      continue;
    }
    await rm(join(dir, item), { recursive: true });
  }
};

export const listFilesInDirectory = async (dir: string): Promise<string[]> => {
  if (!existsSync(dir)) {
    return [];
  }

  const files = (await readdir(dir, { withFileTypes: true })).filter((item) => !item.isDirectory()).map((file) => join(dir, file.name));
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files;
};

export const getFileSize = async (path: string): Promise<number> => {
  const stats = await stat(path);
  return stats.size;
};
