import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Logger } from '@map-colonies/js-logger';
import { HttpUpstreamResponseError, HttpUpstreamUnavailableError } from '../common/errors';

interface ErrorResponseData {
  message: string;
}

type AxiosRequestArgs<D> = AxiosRequestArgsWithoutData | AxiosRequestArgsWithData<D>;
export type AxiosRequestArgsWithoutData = [string, AxiosRequestConfig?];
export type AxiosRequestArgsWithData<D> = [string, D?, AxiosRequestConfig?];

export interface HttpResponse<R> {
  data: R;
  contentType: string;
  code: number;
}

export abstract class BaseClient {
  public constructor(public readonly logger: Logger) {}

  public invokeHttp = async <D, R, A extends AxiosRequestArgs<D>, F extends (...args: A) => Promise<AxiosResponse<R>>, E = ErrorResponseData>(
    func: F,
    ...args: A
  ): Promise<HttpResponse<R>> => {
    try {
      const response = await func(...args);
      return { data: response.data, contentType: response.headers['content-type'], code: response.status };
    } catch (error) {
      const axiosError = error as AxiosError<E>;
      this.logger.debug(axiosError.toJSON());
      this.logger.error(`received the following error message: ${axiosError.message}`);
      if (axiosError.response !== undefined) {
        this.logger.error(`upstream responded with: ${JSON.stringify(axiosError.response.data)}`);
        throw new HttpUpstreamResponseError(`upstream responded with an error, status code ${axiosError.response.status}`);
      } else if (axiosError.request !== undefined) {
        throw new HttpUpstreamUnavailableError('no response received from the upstream');
      } else {
        throw new Error('request failed to dispatch');
      }
    }
  };
}
