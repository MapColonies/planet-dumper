import { describe, it, expect } from 'vitest';
import type { Arguments } from 'yargs';
import { dumpServerUriCheck, httpHeadersCheck } from '@src/commands/create/checks';
import { CheckError } from '@common/errors';
import type { DumpServerConfig } from '@common/interfaces';

const buildArgv = (dumpServerEndpoint: string | undefined, dumpServerHeaders: string[]): Arguments<DumpServerConfig> => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- required by yargs' Arguments<T> shape
  _: [],
  $0: 'planet-dumper',
  dumpServerEndpoint,
  dumpServerHeaders,
});

describe('create checks', () => {
  describe('#dumpServerUriCheck', () => {
    it('accepts an undefined dump server endpoint', () => {
      expect(dumpServerUriCheck(buildArgv(undefined, []))).toBe(true);
    });

    it('accepts a valid web uri', () => {
      expect(dumpServerUriCheck(buildArgv('https://dump-server.example.com', []))).toBe(true);
    });

    it('rejects an invalid uri', () => {
      expect(() => dumpServerUriCheck(buildArgv('not-a-uri', []))).toThrow(CheckError);
    });
  });

  describe('#httpHeadersCheck', () => {
    it('accepts an empty headers array', () => {
      expect(httpHeadersCheck(buildArgv(undefined, []))).toBe(true);
    });

    it('accepts headers in key=value format', () => {
      expect(httpHeadersCheck(buildArgv(undefined, ['X-API-KEY=secret', 'X-Other=value']))).toBe(true);
    });

    it('rejects a header missing the "=" separator', () => {
      expect(() => httpHeadersCheck(buildArgv(undefined, ['X-API-KEY']))).toThrow(CheckError);
    });
  });
});
