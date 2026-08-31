import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { streamToString, fetchSequenceNumber } from '@common/util';

describe('util', () => {
  describe('#streamToString', () => {
    describe('Happy Path', () => {
      it('concatenates string chunks emitted by the stream', async () => {
        const stream = Readable.from(['hello ', 'world']) as unknown as NodeJS.ReadStream;

        await expect(streamToString(stream)).resolves.toBe('hello world');
      });

      it('concatenates buffer chunks emitted by the stream', async () => {
        const stream = Readable.from([Buffer.from('hello '), Buffer.from('world')]) as unknown as NodeJS.ReadStream;

        await expect(streamToString(stream)).resolves.toBe('hello world');
      });
    });

    describe('Sad Path', () => {
      it('rejects when the stream emits an error', async () => {
        const stream = new Readable({
          read() {
            this.emit('error', new Error('boom'));
          },
        }) as unknown as NodeJS.ReadStream;

        await expect(streamToString(stream)).rejects.toThrow('boom');
      });
    });
  });

  describe('#fetchSequenceNumber', () => {
    describe('Happy Path', () => {
      it('extracts the sequence number from a state file body', () => {
        const content = 'sequenceNumber=123\ntimestamp=2024-01-01T00:00:00Z\n';

        expect(fetchSequenceNumber(content)).toBe('123');
      });
    });

    describe('Bad Path', () => {
      it('throws when the content has no sequenceNumber line', () => {
        expect(() => fetchSequenceNumber('timestamp=2024-01-01T00:00:00Z\n')).toThrow();
      });

      it('throws on empty content', () => {
        expect(() => fetchSequenceNumber('')).toThrow();
      });
    });
  });
});
