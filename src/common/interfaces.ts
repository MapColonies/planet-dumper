import { MediatorConfig } from '@map-colonies/arstotzka-mediator';

export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface DumpMetadataOptions {
  dumpNameFormat: string;
  stateBucketName?: string;
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
  sequenceNumber?: number;
}

export interface ArstotzkaConfig {
  enabled: boolean;
  serviceId: string;
  mediator: MediatorConfig;
}
