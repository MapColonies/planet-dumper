/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { Readable } from 'stream';
import { Logger } from '@map-colonies/js-logger';
import { S3Client, HeadObjectCommand, HeadBucketCommand, HeadObjectCommandOutput, HeadBucketCommandOutput } from '@aws-sdk/client-s3';
import { Upload, Progress } from '@aws-sdk/lib-storage';
import { S3Error } from '../common/errors';
import { IConfig, S3Config } from '../common/interfaces';
import { S3_NOT_FOUND_ERROR_NAME, S3_REGION } from '../common/constants';

type ValidationType = 'bucket' | 'object';

type StringifiedProgress = { [Property in keyof Progress]-?: string };

// TODO: fix types (Upload, Progress)
interface ProgressLike {
  loaded?: number;
  total?: number;
  part?: number;
  Key?: string;
  Bucket?: string;
}

const stringifyProgress = (progress: Progress): StringifiedProgress => {
  const undefinedValue = '-';
  const result: { [k: string]: string } = {};

  Object.entries(progress as ProgressLike).forEach(([key, value]) => {
    const stringifiedValue = value != undefined ? value.toString() : undefinedValue;
    result[key] = stringifiedValue;
  });

  return result as StringifiedProgress;
};

export class S3ClientWrapper {
  private readonly s3Config: S3Config;
  private readonly s3Client: S3Client;

  public constructor(private readonly logger: Logger, private readonly config: IConfig) {
    this.s3Config = config.get<S3Config>('s3');
    this.s3Client = new S3Client({
      endpoint: this.s3Config.endpoint,
      region: S3_REGION,
      forcePathStyle: true,
    });
  }

  public async multipartUploadWrapper(key: string, body: Readable): Promise<void> {
    const {
      bucketName,
      acl,
      upload: { concurrency, logProgress, sizePerPart },
    } = this.s3Config;

    this.logger.info(`putting key ${key} in bucket ${this.s3Config.bucketName} with ${this.s3Config.acl} acl`);
    this.logger.debug(`initializing multiplart upload command with concurrency: ${concurrency} size per part: ${sizePerPart}`);

    const upload = new Upload({
      client: this.s3Client,
      params: { Bucket: `${bucketName}`, Key: key, Body: body, ACL: acl },
      queueSize: concurrency,
      partSize: sizePerPart,
    });

    if (logProgress) {
      upload.on('httpUploadProgress', (progress) => {
        const { Bucket, Key, part, loaded, total } = stringifyProgress(progress);
        this.logger.info(`upload of key: ${Key} to bucket: ${Bucket} part: ${part}, loaded ${loaded} out of ${total}`);
      });
    }

    try {
      await upload.done();
    } catch (error) {
      const s3Error = error as Error;
      this.logger.error(s3Error);
      await upload.abort();
      throw new S3Error(`an error occurred during the put of key ${key} on bucket ${this.s3Config.bucketName}, ${s3Error.message}`);
    }
  }

  public async validateExistance(type: ValidationType, value?: string): Promise<boolean> {
    const validationFunc = type === 'bucket' ? this.headBucketWrapper.bind(this) : this.headObjectWrapper.bind(this);
    const exists = await validationFunc(value);
    return exists !== undefined;
  }

  public shutDown(): void {
    this.s3Client.destroy();
  }

  private async headBucketWrapper(bucket: string = this.s3Config.bucketName): Promise<HeadBucketCommandOutput | undefined> {
    this.logger.info(`initializing head bucket ${this.s3Config.bucketName} command`);

    try {
      const command = new HeadBucketCommand({ Bucket: bucket });
      return await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      if (s3Error.name === S3_NOT_FOUND_ERROR_NAME) {
        return undefined;
      }
      this.logger.error(s3Error);
      throw new S3Error(`an error occurred during head bucket ${bucket}, ${s3Error.message}`);
    }
  }

  private async headObjectWrapper(key: string): Promise<HeadObjectCommandOutput | undefined> {
    this.logger.info(`initializing head object command with key ${key} in bucket ${this.s3Config.bucketName}`);

    try {
      const command = new HeadObjectCommand({ Bucket: this.s3Config.bucketName, Key: key });
      return await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      if (s3Error.name === S3_NOT_FOUND_ERROR_NAME) {
        return undefined;
      }
      this.logger.error(s3Error);
      throw new S3Error(`an error occurred during head object with key ${key} ${this.s3Config.endpoint}, ${s3Error.message}`);
    }
  }
}
