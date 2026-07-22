import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { injectable } from 'tsyringe';
import { NOT_FOUND_INDEX } from '@common/constants';

@injectable()
export class FsRepository {
  public async createDirectoryIfNotAlreadyExists(this: void, dir: string): Promise<void> {
    if (existsSync(dir)) {
      return;
    }
    await mkdir(dir, { recursive: true });
  }

  public async removeDirectory(this: void, dir: string): Promise<void> {
    if (!existsSync(dir)) {
      return;
    }
    await rm(dir, { recursive: true });
  }

  public async emptyDirectory(this: void, dir: string, whiteList: string[] = []): Promise<void> {
    if (!existsSync(dir)) {
      return;
    }

    for (const item of await readdir(dir)) {
      if (whiteList.indexOf(item) !== NOT_FOUND_INDEX) {
        continue;
      }
      await rm(join(dir, item), { recursive: true });
    }
  }

  public async listFilesInDirectory(this: void, dir: string): Promise<string[]> {
    if (!existsSync(dir)) {
      return [];
    }

    const files = (await readdir(dir, { withFileTypes: true })).filter((item) => !item.isDirectory()).map((file) => join(dir, file.name));
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return files;
  }

  public async getFileSize(this: void, path: string): Promise<number> {
    const stats = await stat(path);
    return stats.size;
  }
}
