import { Logger } from '@map-colonies/js-logger';
import axios, { AxiosInstance } from 'axios';
import { DumpMetadata, DumpServerConfig, IConfig } from '../common/interfaces';
import { AxiosRequestArgsWithData, BaseClient, HttpResponse } from './baseClient';

const DUMP_METADATA_ENDPOINT = 'dumps';

export interface DumpMetadataCreationBody extends Required<DumpMetadata> {
  description?: string;
}

export class DumpClient extends BaseClient {
  private readonly dumpServerConfig: DumpServerConfig;
  private readonly httpClient: AxiosInstance;

  public constructor(logger: Logger, private readonly config: IConfig) {
    super(logger);
    this.httpClient = axios.create({ timeout: config.get('httpClient.timeout') });
    this.dumpServerConfig = config.get<DumpServerConfig>('dumpServer');
  }

  public async postDumpMetadata(body: DumpMetadataCreationBody): Promise<HttpResponse<string>> {
    const { endpoint, token } = this.dumpServerConfig;
    this.logger.info(`invoking POST to ${endpoint}/${DUMP_METADATA_ENDPOINT}`);

    const headers: Record<string, string> = {};
    if (token.enabled) {
      headers['Authorization'] = `Bearer ${token.value as string}`;
    }

    const funcRef = this.httpClient.post.bind(this.httpClient);

    return this.invokeHttp<DumpMetadataCreationBody, string, AxiosRequestArgsWithData<DumpMetadataCreationBody>, typeof funcRef>(
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
