import Format from 'string-format';

// TODO: improve args
export const nameFormat = (format: string, state?: string): string => {
  const now = new Date();
  return Format(format, { timestamp: now.toISOString(), state });
};
