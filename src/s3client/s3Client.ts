/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { Readable } from 'stream';
import { Logger } from '@map-colonies/js-logger';
import {
  S3Client,
  HeadObjectCommand,
  HeadBucketCommand,
  HeadObjectCommandOutput,
  HeadBucketCommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { S3Error } from '../common/errors';
import { IConfig, S3Config } from '../common/interfaces';
import { S3_NOT_FOUND_ERROR_NAME, S3_REGION } from '../common/constants';

type ValidationType = 'bucket' | 'object';

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

  public async putObjectWrapper(key: string, body: Readable): Promise<void> {
    const { bucketName, acl } = this.s3Config;
    this.logger.info(`putting key ${key} in bucket ${bucketName} with ${acl} acl`);

    try {
      const command = new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ACL: acl });
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      this.logger.error(s3Error);
      throw new S3Error(`an error occurred during the put of key ${key} on bucket ${bucketName}, ${s3Error.message}`);
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
