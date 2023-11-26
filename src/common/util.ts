import { join } from 'path';
import { existsSync, statSync } from 'fs';
import { mkdir, readdir, rmdir, stat, rm } from 'fs/promises';
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
  await rmdir(dir, { recursive: true });
};

export const emptyDirectory = async (dir: string, whiteList: string[] = []): Promise<void> => {
  if (!existsSync(dir)) {
    return;
  }

  for await (const item of await readdir(dir)) {
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
