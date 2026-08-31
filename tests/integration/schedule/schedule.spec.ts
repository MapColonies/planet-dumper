import { container } from 'tsyringe';
import axios from 'axios';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTasks } from 'node-cron';
import { scheduleCommandFactory } from '@src/commands/schedule/scheduleFactory';
import { SERVICES } from '@common/constants';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { buildConfig, buildFsRepository, delay, disabledArstotzkaConfig } from '@tests/fixtures';

describe('schedule command - noOverlap', () => {
  afterEach(() => {
    getTasks().forEach((task) => {
      void task.destroy();
    });
    vi.restoreAllMocks();
  });

  it('skips a scheduled tick while the previous run is still in-flight, and resumes once it releases', async () => {
    const logger = await jsLogger({ enabled: false });
    const warnSpy = vi.spyOn(logger, 'warn');

    let releaseFirstRun: () => void = () => {};
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    const manager = new PgDumpManager(logger, buildConfig(), axios.create(), buildFsRepository());
    vi.spyOn(manager, 'getState').mockResolvedValue('1');
    const createPgDump = vi.spyOn(manager, 'createPgDump').mockImplementation(async () => {
      await firstRunGate;
      return '/workdir/1/pg_dump/dump.dmp';
    });

    const childContainer = container.createChildContainer();
    childContainer.register(SERVICES.LOGGER, { useValue: logger });
    childContainer.register(SERVICES.CONFIG, { useValue: buildConfig() });
    childContainer.register(SERVICES.ARSTOTZKA, { useValue: disabledArstotzkaConfig });
    childContainer.register(PgDumpManager, { useValue: manager });

    const { handler } = scheduleCommandFactory(childContainer);
    const handlerPromise = handler({ _: [], $0: 'planet-dumper' });

    await delay(2200);

    expect(createPgDump).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'skipped scheduled tick because the previous run is still in-flight' }));

    releaseFirstRun();
    process.emit('SIGTERM');
    await handlerPromise;
  }, 10000);
});
