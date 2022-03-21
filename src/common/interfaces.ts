export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
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
  s3ProjectId?: string;
}

export interface PostgresConfig {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
  sslMode: string;
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
}
