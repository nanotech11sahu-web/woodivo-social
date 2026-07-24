import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MetaPublishException } from '../shared/exceptions/app.exceptions';

export interface MetaApiResult<T = Record<string, unknown>> {
  data: T;
  statusCode: number;
}

/**
 * Thin, reusable wrapper around the Meta Graph API HTTP surface. FacebookService
 * and InstagramService both depend on this instead of talking to axios/Graph
 * endpoints directly, keeping request construction and error mapping in one place.
 */
@Injectable()
export class MetaGraphClient {
  private readonly client: AxiosInstance;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MetaGraphClient.name);
    this.client = axios.create({
      baseURL: `${this.appConfig.meta.graphApiBaseUrl}/${this.appConfig.meta.graphApiVersion}`,
      timeout: this.appConfig.meta.requestTimeoutMs,
    });
  }

  async get<T = Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | boolean>,
  ): Promise<MetaApiResult<T>> {
    try {
      const response = await this.client.get<T>(endpoint, { params });
      return { data: response.data, statusCode: response.status };
    } catch (error) {
      throw this.toMetaException(error, endpoint);
    }
  }

  async post<T = Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | boolean>,
  ): Promise<MetaApiResult<T>> {
    try {
      const response = await this.client.post<T>(endpoint, null, { params });
      return { data: response.data, statusCode: response.status };
    } catch (error) {
      throw this.toMetaException(error, endpoint);
    }
  }

  private toMetaException(error: unknown, endpoint: string): MetaPublishException {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const graphError = (error.response?.data as { error?: { message?: string; code?: number } })
        ?.error;
      const recoverable = !status || status >= 500 || status === 429;
      this.logger.error({ endpoint, status, graphError }, 'Meta Graph API request failed');
      return new MetaPublishException(
        `Meta Graph API error on ${endpoint}: ${graphError?.message ?? error.message}`,
        recoverable,
        status,
        { graphError },
      );
    }
    this.logger.error(
      { endpoint, error: (error as Error).message },
      'Unexpected Meta Graph API error',
    );
    return new MetaPublishException(
      `Unexpected error calling Meta Graph API (${endpoint}): ${(error as Error).message}`,
      true,
    );
  }
}
