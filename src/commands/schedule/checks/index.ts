import { validate } from 'node-cron';
import { CheckError } from '@common/errors';
import type { CheckFunc } from '@src/wrappers/check';

const CRON_EXPRESSION_CHECK_ARG = 'cli.schedule.cronExpression';

export const cronExpressionCheck: CheckFunc<string> = (cronExpression) => {
  if (!validate(cronExpression)) {
    throw new CheckError(`${CRON_EXPRESSION_CHECK_ARG} is not a valid cron expression`, CRON_EXPRESSION_CHECK_ARG, cronExpression);
  }
  return true;
};
