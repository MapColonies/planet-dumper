import Format from 'string-format';
import { DumpMetadata } from '../../common/interfaces';

const now = new Date();

export const nameFormat = (format: string, state?: string): string => {
  return Format(format, { timestamp: now.toISOString(), state });
};

export const buildDumpMetadata = (format: string, state: string): DumpMetadata => {
  const name = Format(format, { timestamp: now.toISOString(), state });

  return {
    name,
    timestamp: now,
    sequenceNumber: +state,
  };
};
