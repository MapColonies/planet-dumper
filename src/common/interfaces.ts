import { MediatorConfig } from '@map-colonies/arstotzka-mediator';

export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

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

export interface S3Config {
  s3Endpoint: string;
  s3BucketName: string;
  s3Acl: string;
}

export interface PostgresConfig {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
}

export interface PgDumpConfig {
  verbose: boolean;
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

export interface ArstotzkaConfig {
  enabled: boolean;
  services: {
    [key: string]: string;
  };
  mediator: MediatorConfig;
}
