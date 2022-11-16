import { SEQUENCE_NUMBER_REGEX } from './constants';

export const streamToString = async (stream: NodeJS.ReadStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    stream.setEncoding('utf8');
    let data = '';
    stream.on('data', (chunk) => (data += chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(data));
  });
};

export const fetchSequenceNumber = (content: string): number => {
  const matchResult = content.match(SEQUENCE_NUMBER_REGEX);
  if (matchResult === null || matchResult.length === 0) {
    throw new Error();
  }

  return parseInt(matchResult[0].split('=')[1]);
};

export const parseHeadersArg = (headers: string[]): Record<string, string> => {
  const requestHeaders: Record<string, string> = {};
  headers.forEach((headerKeyValue) => {
    const [key, value] = headerKeyValue.trim().split('=');
    requestHeaders[key] = value;
  });
  return requestHeaders;
};
