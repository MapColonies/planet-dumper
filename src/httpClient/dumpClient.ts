import { Logger } from '@map-colonies/js-logger';
import { AxiosInstance } from 'axios';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '../common/constants';
import { DumpMetadata, DumpServerConfig } from '../common/interfaces';
import { AxiosRequestArgsWithData, BaseClient, HttpResponse } from './baseClient';

const DUMP_METADATA_ENDPOINT = 'dumps';

export interface DumpMetadataCreationBody extends Required<DumpMetadata> {
  description?: string;
}

@injectable()
export class DumpServerClient extends BaseClient {
  public constructor(@inject(SERVICES.LOGGER) logger: Logger, @inject(SERVICES.HTTP_CLIENT) private readonly httpClient: AxiosInstance) {
    super(logger);
  }

  public async postDumpMetadata(dumpServerConfig: DumpServerConfig, body: DumpMetadataCreationBody): Promise<HttpResponse<string>> {
    const { dumpServerEndpoint: endpoint, dumpServerToken: token } = dumpServerConfig;

    this.logger.info({ msg: 'invoking http request POST', url: `${endpoint}/${DUMP_METADATA_ENDPOINT}` });

    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers['Authorization'] = `Bearer ${token}`;
    }

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
