export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface AppConfig {
  dumpName: {
    dumpPrefix: {
      enabled: boolean;
      value?: string;
    };
    addTimestamp: boolean;
    value: string;
  };
  dumpUpload: {
    s3: boolean;
    dumpServer: boolean;
  };
}

export interface S3Config {
  endpoint: string;
  bucketName: string;
  acl: string;
  upload: {
    concurrency: number;
    sizePerPart: number;
    logProgress: boolean;
  };
}

export interface PostgresConfig {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
}

export interface PgDumpConfig {
  verbose: boolean;
}

export interface DumpServerConfig {
  endpoint: string;
  token: {
    enabled: boolean;
    value?: string;
  };
}

export interface DumpMetadata {
  name: string;
  bucket?: string;
  timestamp: Date;
}
