import { container } from 'tsyringe';
import axios from 'axios';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTasks } from 'node-cron';
import type { Arguments } from 'yargs';
import { scheduleCommandFactory } from '@src/commands/schedule/scheduleFactory';
import type { ScheduleArguments } from '@src/commands/schedule/scheduleFactory';
import { SERVICES } from '@common/constants';
import { PgDumpManager } from '@src/commands/pgDump/pgDumpManager';
import { PG_DUMP_MANAGER_FACTORY } from '@src/commands/pgDump/pgDumpManagerFactory';
import type { ArstotzkaConfig } from '@common/interfaces';
import type { ConfigType } from '@common/config';

const delay = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const buildConfig = (): ConfigType => ({
  get: vi.fn().mockReturnValue({}),
  getAll: vi.fn(),
  getConfigParts: vi.fn(),
  getResolvedOptions: vi.fn(),
  initializeMetrics: vi.fn(),
});

const disabledArstotzkaConfig: ArstotzkaConfig = {
  enabled: false,
  services: { planetDumperPg: 'pg-service', planetDumperNg: 'ng-service' },
  mediator: {
    timeout: 1000,
    enableRetryStrategy: false,
    retryStrategy: {},
    actiony: {},
    locky: {},
  },
};

const buildArgv = (overrides: Partial<ScheduleArguments>): Arguments<ScheduleArguments> => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
  _: [],
  $0: 'planet-dumper',
  outputFormat: 'dump_{state}_{timestamp}.pbf',
  stateSource: '1',
  cleanupMode: 'none',
  s3Acl: 'private',
  dumpServerHeaders: [],
  resume: false,
  info: false,
  target: 'pg_dump',
  cronExpression: '* * * * * *',
  runOnInit: false,
  ...overrides,
});

describe('schedule command - noOverlap', () => {
  afterEach(() => {
    // clean up any task left registered in node-cron's global registry so it doesn't leak into other tests
    for (const task of getTasks().values()) {
      void task.destroy();
    }
    vi.restoreAllMocks();
  });

  it('skips a scheduled tick while the previous run is still in-flight, and resumes once it releases', async () => {
    const logger = await jsLogger({ enabled: false });
    const warnSpy = vi.spyOn(logger, 'warn');

    // gate the first run on an explicit signal instead of a fixed delay, so "still in-flight"
    // is guaranteed rather than timing-dependent on how fast the test happens to run
    let releaseFirstRun: () => void = () => {};
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    const manager = new PgDumpManager(logger, buildConfig(), axios.create());
    vi.spyOn(manager, 'getState').mockResolvedValue('1');
    const createPgDump = vi.spyOn(manager, 'createPgDump').mockImplementation(async () => {
      await firstRunGate;
      return '/workdir/1/pg_dump/dump.dmp';
    });

    const childContainer = container.createChildContainer();
    childContainer.register(SERVICES.LOGGER, { useValue: logger });
    childContainer.register(SERVICES.ARSTOTZKA, { useValue: disabledArstotzkaConfig });
    childContainer.register(PG_DUMP_MANAGER_FACTORY, { useValue: manager });

    const { handler } = scheduleCommandFactory(childContainer);
    const handlerPromise = handler(buildArgv({}));

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
