import { container } from 'tsyringe';
import axios from 'axios';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTasks } from 'node-cron';
import { scheduleCommandFactory } from '@src/commands/schedule/scheduleFactory';
import { SERVICES } from '@common/constants';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from '@src/commands/pgDump/pgDumpManagerFactory';
import { buildConfig, buildFsRepository, delay, disabledArstotzkaConfig } from '@tests/fixtures';

describe('schedule command - noOverlap', () => {
  afterEach(() => {
    // clean up any task left registered in node-cron's global registry so it doesn't leak into other tests.
    getTasks().forEach((task) => {
      void task.destroy();
    });
    vi.restoreAllMocks();
  });

  it('skips a scheduled tick while the previous run is still in-flight, and resumes once it releases', async () => {
    const logger = await jsLogger({ enabled: false });
    const warnSpy = vi.spyOn(logger, 'warn');

    // gate the first run on an explicit signal instead of a fixed delay, so "still in-flight"
    // is guaranteed rather than timing-dependent on how fast the test happens to run.
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
    childContainer.register(PG_DUMP_MANAGER_FACTORY, { useValue: manager });

    const { handler } = scheduleCommandFactory(childContainer);
    // handler no longer reads argv (everything comes from config), but its type signature
    // still requires an Arguments-shaped stub since it satisfies yargs' CommandModule
    // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
    const handlerPromise = handler({ _: [], $0: 'planet-dumper' });

    // the cron ticks every second; wait long enough for at least two ticks to have landed
    // while the first run is still blocked on firstRunGate
    await delay(2200);

    expect(createPgDump).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'skipped scheduled tick because the previous run is still in-flight' }));

    releaseFirstRun();
    process.emit('SIGTERM');
    await handlerPromise;
  }, 10000);
});
