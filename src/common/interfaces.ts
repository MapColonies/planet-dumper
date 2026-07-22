import type { vectorPlanetDumperV1Type } from '@map-colonies/schemas';

export interface LogFn {
  (obj: unknown, msg?: string, ...args: unknown[]): void;
  (msg: string, ...args: unknown[]): void;
}

export interface ILogger {
  trace?: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal?: LogFn;
}

export interface DumpServerConfig {
  dumpServerEndpoint?: string;
  dumpServerHeaders: string[];
}

export interface DumpMetadata {
  name: string;
  bucket?: string;
  timestamp: Date;
  sequenceNumber: number;
}

export type ArstotzkaConfig = vectorPlanetDumperV1Type['arstotzka'];
