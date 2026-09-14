import { SEQUENCE_NUMBER_REGEX } from './constants';

export const streamToString = async (stream: NodeJS.ReadStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    stream.setEncoding('utf8');
    let data = '';
    stream.on('data', (chunk: Buffer | string) => (data += chunk.toString()));
    stream.on('error', reject);
    stream.on('end', () => resolve(data));
  });
};

export const fetchSequenceNumber = (content: string): string => {
  const [match] = content.match(SEQUENCE_NUMBER_REGEX) ?? [];
  const sequenceNumber = match?.split('=')[1];

  if (sequenceNumber === undefined) {
    throw new Error();
  }

  return sequenceNumber;
};
