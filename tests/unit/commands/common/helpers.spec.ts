import { describe, it, expect } from 'vitest';
import { nameFormat, buildDumpMetadata } from '@src/commands/common/helpers';

describe('helpers', () => {
  const timestamp = new Date('2024-01-01T00:00:00.000Z');

  describe('#nameFormat', () => {
    it('substitutes state and timestamp into the format string', () => {
      const result = nameFormat('dump_{state}_{timestamp}.pbf', timestamp, '42');

      expect(result).toBe(`dump_42_${timestamp.toISOString()}.pbf`);
    });

    it('leaves an undefined state as the literal "undefined"', () => {
      const result = nameFormat('dump_{state}.pbf', timestamp);

      expect(result).toBe('dump_undefined.pbf');
    });
  });

  describe('#buildDumpMetadata', () => {
    it('builds metadata with a numeric sequenceNumber parsed from state', () => {
      const metadata = buildDumpMetadata('dump_{state}_{timestamp}.pbf', timestamp, '42');

      expect(metadata).toEqual({
        name: `dump_42_${timestamp.toISOString()}.pbf`,
        timestamp,
        sequenceNumber: 42,
      });
    });
  });
});
