export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export type DumpMetadataOptions = DumpStateOptions & DumpNameOptions;

export interface DumpStateOptions {
  includeState: boolean;
  stateBucketName: string;
}

export interface DumpNameOptions {
  dumpNamePrefix?: string;
  dumpName: string;
  dumpNameTimestamp: boolean;
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
  dumpServerEndpoint: string;
  dumpServerToken?: string;
}

export interface DumpMetadata {
  name: string;
  bucket?: string;
  timestamp: Date;
  sequenceNumber?: number;
}
