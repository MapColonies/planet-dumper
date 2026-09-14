import express, { json, type Express, type Response } from 'express';
import type { Logger } from '@map-colonies/js-logger';
import { serve as swaggerServe, setup as swaggerSetup } from 'swagger-ui-express';

const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

const isNumericStateSource = (value: unknown): value is string => typeof value === 'string' && !isNaN(parseInt(value, 10));

export class RunInProgressError extends Error {}

export interface HttpTriggers {
  runPgDump: () => boolean;
  runCreate: (stateSource?: string) => boolean;
}

export const httpServerFactory = (logger: Logger, triggers: HttpTriggers, openApiSpec?: object): Express => {
  const app = express();
  app.use(json());

  if (openApiSpec !== undefined) {
    app.use('/docs', swaggerServe, swaggerSetup(openApiSpec));
  }

  const respondToTriggerOutcome = (res: Response, started: boolean): void => {
    if (!started) {
      res.status(HTTP_CONFLICT).json({ status: 'busy', message: 'a run is already in progress' });
      return;
    }
    res.status(HTTP_ACCEPTED).json({ status: 'started' });
  };

  app.post('/pg_dump', (req, res): void => {
    logger.info({ msg: 'received manual pg_dump trigger via api' });
    respondToTriggerOutcome(res, triggers.runPgDump());
  });

  app.post('/create', (req, res): void => {
    const { stateSource } = req.body as { stateSource?: unknown };

    if (stateSource !== undefined && !isNumericStateSource(stateSource)) {
      res.status(HTTP_BAD_REQUEST).json({ status: 'invalid', message: 'stateSource must be a numeric sequence number' });
      return;
    }

    logger.info({ msg: 'received manual create trigger via api', stateSource });
    respondToTriggerOutcome(res, triggers.runCreate(stateSource));
  });

  app.get('/health', (req, res): void => {
    res.status(HTTP_OK).json({ status: 'ok' });
  });

  return app;
};
