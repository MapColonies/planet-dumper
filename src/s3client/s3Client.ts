/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import {
  S3Client,
  HeadObjectCommand,
  HeadBucketCommand,
  HeadObjectCommandOutput,
  HeadBucketCommandOutput,
  PutObjectCommand,
  ObjectCannedACL,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { S3Error } from '../common/errors';
import { S3_NOT_FOUND_ERROR_NAME, SERVICES } from '../common/constants';

type HeadCommandType = 'bucket' | 'object';

@injectable()
export class S3ClientWrapper {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SERVICES.S3) private readonly s3Client: S3Client) {}

  public async getObjectWrapper(bucketName: string, key: string): Promise<NodeJS.ReadStream> {
    this.logger.debug({ msg: 'getting object from s3', key, bucketName });

    try {
      const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
      const commandOutput = await this.s3Client.send(command);
      return commandOutput.Body as NodeJS.ReadStream;
    } catch (error) {
      const s3Error = error as Error;
      this.logger.error({ err: s3Error, msg: 'failed getting key from bucket', key, bucketName });
      throw new S3Error(`an error occurred during the get of key ${key} from bucket ${bucketName}, ${s3Error.message}`);
    }
  }

  public async putObjectWrapper(bucket: string, key: string, body: Buffer, acl?: ObjectCannedACL | string): Promise<void> {
    this.logger.debug({ msg: 'putting key in bucket', key, bucketName: bucket, acl });

    try {
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ACL: acl });
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      this.logger.error({ err: s3Error, msg: 'failed putting key in bucket', acl, bucketName: bucket });
      throw new S3Error(`an error occurred during the put of key ${key} on bucket ${bucket}, ${s3Error.message}`);
    }
  }

  public async deleteObjectWrapper(bucketName: string, key: string): Promise<boolean> {
    this.logger.debug({ msg: 'deleting object from s3', key, bucketName });

    let hasSucceeded = true;

    try {
      const command = new DeleteObjectCommand({ Bucket: bucketName, Key: key });
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      this.logger.error({ err: s3Error, msg: 'failed deleting key from bucket', key, bucketName });
      hasSucceeded = false;
    }

    return hasSucceeded;
  }

  public async validateExistance(type: HeadCommandType, value: string, bucket?: string): Promise<boolean> {
    const exists = type === 'bucket' ? await this.headBucketWrapper(value) : await this.headObjectWrapper(bucket as string, value);
    return exists !== undefined;
  }

  private async headBucketWrapper(bucket: string): Promise<HeadBucketCommandOutput | undefined> {
    this.logger.debug({ msg: 'heading bucket', bucketName: bucket });

    try {
      const command = new HeadBucketCommand({ Bucket: bucket });
      return await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      if (s3Error.name === S3_NOT_FOUND_ERROR_NAME) {
        return undefined;
      }

      this.logger.error({ err: s3Error, msg: 'failed to head bucket', bucketName: bucket });
      throw new S3Error(`an error occurred during head bucket ${bucket}, ${s3Error.message}`);
    }
  }

  private async headObjectWrapper(bucket: string, key: string): Promise<HeadObjectCommandOutput | undefined> {
    this.logger.debug({ msg: 'heading object', key, bucketName: bucket });

    try {
      const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
      return await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      if (s3Error.name === S3_NOT_FOUND_ERROR_NAME) {
        return undefined;
      }

      this.logger.error({ err: s3Error, msg: 'failed to head objcet', bucketName: bucket, key });
      throw new S3Error(`an error occurred during head object with bucket ${bucket} key ${key}, ${s3Error.message}`);
    }
  }
}
