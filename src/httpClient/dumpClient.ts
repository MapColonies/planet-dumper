import { Logger } from '@map-colonies/js-logger';
import { AxiosInstance } from 'axios';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '../common/constants';
import { DumpMetadata } from '../common/interfaces';
import { AxiosRequestArgsWithData, BaseClient, HttpResponse } from './baseClient';

const DUMP_METADATA_ENDPOINT = 'dumps';

export interface DumpMetadataCreationBody extends Required<Omit<DumpMetadata, 'sequenceNumber'>> {
  description?: string;
  sequenceNumber?: number;
}

@injectable()
export class DumpServerClient extends BaseClient {
  public constructor(@inject(SERVICES.LOGGER) logger: Logger, @inject(SERVICES.HTTP_CLIENT) private readonly httpClient: AxiosInstance) {
    super(logger);
  }

  public async postDumpMetadata(endpoint: string, body: DumpMetadataCreationBody, headers?: Record<string, string>): Promise<HttpResponse<string>> {
    this.logger.info({ msg: 'invoking POST http request', url: `${endpoint}/${DUMP_METADATA_ENDPOINT}`, headers: Object.keys(headers ?? {}) });

    const funcRef = this.httpClient.post.bind(this.httpClient);

    return this.invokeHttp<string, DumpMetadataCreationBody, AxiosRequestArgsWithData<DumpMetadataCreationBody>, typeof funcRef>(
      funcRef,
      DUMP_METADATA_ENDPOINT,
      body,
      {
        baseURL: endpoint,
        headers,
      }
    );
  }
}
