import { Readable } from 'node:stream';
import type { Logger } from '@map-colonies/js-logger';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3ClientWrapper } from '@src/s3client/s3Client';
import { S3Error } from '@common/errors';
import { S3_NOT_FOUND_ERROR_NAME } from '@common/constants';
import { buildConfig } from '@tests/fixtures';

const { uploadDoneMock, uploadOnMock, uploadConstructorMock } = vi.hoisted(() => ({
  uploadDoneMock: vi.fn().mockResolvedValue(undefined),
  uploadOnMock: vi.fn(),
  uploadConstructorMock: vi.fn(),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(function (options: unknown) {
    uploadConstructorMock(options);
    return { on: uploadOnMock, done: uploadDoneMock };
  }),
}));

const buildLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

const buildS3Client = (): S3Client => ({ send: vi.fn() }) as unknown as S3Client;

const buildWrapper = (
  s3Client: S3Client = buildS3Client(),
  config = buildConfig({ 's3.upload': { concurrency: 4, partSize: 5 } })
): S3ClientWrapper => new S3ClientWrapper(buildLogger(), s3Client, config);

describe('S3ClientWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadDoneMock.mockResolvedValue(undefined);
  });

  describe('Happy Path', () => {
    describe('#getObjectWrapper', () => {
      it('returns the object body on success', async () => {
        const s3Client = buildS3Client();
        vi.mocked(s3Client.send).mockResolvedValue({ Body: 'stream-body' } as never);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.getObjectWrapper('bucket', 'key')).resolves.toBe('stream-body');
      });
    });

    describe('#putObjectWrapper', () => {
      it('puts the object with the given acl', async () => {
        const s3Client = buildS3Client();
        vi.mocked(s3Client.send).mockResolvedValue({} as never);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.putObjectWrapper('bucket', 'key', Buffer.from('data'), 'private')).resolves.toBeUndefined();
        expect(s3Client.send).toHaveBeenCalledOnce();
      });
    });

    describe('#uploadStreamInParallel', () => {
      it('uploads using the configured concurrency and part size', async () => {
        const wrapper = buildWrapper(undefined, buildConfig({ 's3.upload': { concurrency: 4, partSize: 5 } }));

        await wrapper.uploadStreamInParallel('bucket', 'key', Readable.from(['data']), 'private');

        expect(uploadConstructorMock).toHaveBeenCalledWith(
          expect.objectContaining({
            queueSize: 4,
            partSize: 5 * 1048576,
            params: expect.objectContaining({ Bucket: 'bucket', Key: 'key', ACL: 'private' }),
          })
        );
        expect(uploadDoneMock).toHaveBeenCalledOnce();
      });
    });

    describe('#deleteObjectWrapper', () => {
      it('returns true on successful deletion', async () => {
        const s3Client = buildS3Client();
        vi.mocked(s3Client.send).mockResolvedValue({} as never);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.deleteObjectWrapper('bucket', 'key')).resolves.toBe(true);
      });
    });

    describe('#validateExistance', () => {
      it('returns true when the bucket exists', async () => {
        const s3Client = buildS3Client();
        vi.mocked(s3Client.send).mockResolvedValue({} as never);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.validateExistance('bucket', 'my-bucket')).resolves.toBe(true);
      });

      it('returns false when the bucket does not exist', async () => {
        const s3Client = buildS3Client();
        const notFound = Object.assign(new Error('not found'), { name: S3_NOT_FOUND_ERROR_NAME });
        vi.mocked(s3Client.send).mockRejectedValue(notFound);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.validateExistance('bucket', 'missing-bucket')).resolves.toBe(false);
      });

      it('returns true when the object exists', async () => {
        const s3Client = buildS3Client();
        vi.mocked(s3Client.send).mockResolvedValue({} as never);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.validateExistance('object', 'key', 'bucket')).resolves.toBe(true);
      });

      it('returns false when the object does not exist', async () => {
        const s3Client = buildS3Client();
        const notFound = Object.assign(new Error('not found'), { name: S3_NOT_FOUND_ERROR_NAME });
        vi.mocked(s3Client.send).mockRejectedValue(notFound);
        const wrapper = buildWrapper(s3Client);

        await expect(wrapper.validateExistance('object', 'missing-key', 'bucket')).resolves.toBe(false);
      });
    });
  });

  // No Bad Path here: every failure this wrapper can hit is either a graceful "not found" (Happy Path
  // above) or an unexpected AWS-side error wrapped as S3Error (Sad Path below) - there is no
  // validation-style rejection of caller input to test separately.

  describe('Sad Path', () => {
    it('throws S3Error when getting an object fails for a reason other than not-found', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.send).mockRejectedValue(new Error('network error'));
      const wrapper = buildWrapper(s3Client);

      await expect(wrapper.getObjectWrapper('bucket', 'key')).rejects.toThrow(S3Error);
    });

    it('throws S3Error when putting an object fails', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.send).mockRejectedValue(new Error('network error'));
      const wrapper = buildWrapper(s3Client);

      await expect(wrapper.putObjectWrapper('bucket', 'key', Buffer.from('data'))).rejects.toThrow(S3Error);
    });

    it('throws S3Error when the parallel upload fails', async () => {
      uploadDoneMock.mockRejectedValueOnce(new Error('upload failed'));
      const wrapper = buildWrapper();

      await expect(wrapper.uploadStreamInParallel('bucket', 'key', Readable.from(['data']))).rejects.toThrow(S3Error);
    });

    it('returns false, without throwing, when deletion fails', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.send).mockRejectedValue(new Error('network error'));
      const wrapper = buildWrapper(s3Client);

      await expect(wrapper.deleteObjectWrapper('bucket', 'key')).resolves.toBe(false);
    });

    it('throws S3Error when checking bucket existence fails for a reason other than not-found', async () => {
      const s3Client = buildS3Client();
      vi.mocked(s3Client.send).mockRejectedValue(new Error('network error'));
      const wrapper = buildWrapper(s3Client);

      await expect(wrapper.validateExistance('bucket', 'bucket')).rejects.toThrow(S3Error);
    });
  });
});
