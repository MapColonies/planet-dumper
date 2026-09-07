import stringFormat from 'string-format';
import type { DumpMetadata } from '@common/interfaces';

export const nameFormat = (format: string, timestamp: Date, state?: string): string => {
  return stringFormat(format, { timestamp: timestamp.toISOString(), state });
};

export const buildDumpMetadata = (format: string, timestamp: Date, state: string): DumpMetadata => {
  const name = stringFormat(format, { timestamp: timestamp.toISOString(), state });

  return {
    name,
    timestamp,
    sequenceNumber: +state,
  };
};
