import express, { json, type Express, type Response } from 'express';
import type { Logger } from '@map-colonies/js-logger';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const isNumericStateSource = (value: unknown): value is string => typeof value === 'string' && !isNaN(parseInt(value, 10));

export class RunInProgressError extends Error {}

export interface HttpTriggers {
  runPgDump: () => Promise<void>;
  runCreate: (stateSource?: string) => Promise<void>;
}

export const httpServerFactory = (logger: Logger, triggers: HttpTriggers): Express => {
  const app = express();
  app.use(json());

  const respondToRunOutcome = (res: Response, promise: Promise<void>, routeName: string): void => {
    promise
      .then(() => {
        res.status(HTTP_OK).json({ status: 'completed' });
      })
      .catch((error: unknown) => {
        if (error instanceof RunInProgressError) {
          res.status(HTTP_CONFLICT).json({ status: 'busy', message: error.message });
          return;
        }
        logger.error({ err: error, msg: `api-triggered ${routeName} run failed` });
        res.status(HTTP_INTERNAL_SERVER_ERROR).json({ status: 'failed', message: (error as Error).message });
      });
  };

  app.post('/pg_dump', (req, res): void => {
    logger.info({ msg: 'received manual pg_dump trigger via api' });
    respondToRunOutcome(res, triggers.runPgDump(), 'pg_dump');
  });

  app.post('/create', (req, res): void => {
    const { stateSource } = req.body as { stateSource?: unknown };

    if (stateSource !== undefined && !isNumericStateSource(stateSource)) {
      res.status(HTTP_BAD_REQUEST).json({ status: 'invalid', message: 'stateSource must be a numeric sequence number' });
      return;
    }

    logger.info({ msg: 'received manual create trigger via api', stateSource });
    respondToRunOutcome(res, triggers.runCreate(stateSource), 'create');
  });

  app.get('/health', (req, res): void => {
    res.status(HTTP_OK).json({ status: 'ok' });
  });

  return app;
};
