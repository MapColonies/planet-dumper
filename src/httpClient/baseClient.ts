import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Logger } from '@map-colonies/js-logger';
import { inject } from 'tsyringe';
import { HttpUpstreamResponseError, HttpUpstreamUnavailableError } from '../common/errors';
import { SERVICES } from '../common/constants';

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
  public constructor(@inject(SERVICES.LOGGER) public readonly logger: Logger) {}

  public invokeHttp = async <R, D, A extends AxiosRequestArgs<D>, F extends (...args: A) => Promise<AxiosResponse<R>>, E = ErrorResponseData>(
    func: F,
    ...args: A
  ): Promise<HttpResponse<R>> => {
    try {
      const response = await func(...args);
      return { data: response.data, contentType: response.headers['content-type'], code: response.status };
    } catch (error) {
      const axiosError = error as AxiosError<E>;
      if (axiosError.response !== undefined) {
        this.logger.error({ err: axiosError, msg: 'received http upstream error response', response: axiosError.response.data });
        throw new HttpUpstreamResponseError(`upstream responded with an error, status code ${axiosError.response.status}`);
      } else if (axiosError.request !== undefined) {
        this.logger.error({ err: axiosError, msg: 'http upstream unavailable, no response received' });
        throw new HttpUpstreamUnavailableError('no response received from the upstream');
      } else {
        this.logger.error({ err: axiosError, msg: 'failed to dispatch http request' });
        throw new Error('request failed to dispatch');
      }
    }
  };
}
