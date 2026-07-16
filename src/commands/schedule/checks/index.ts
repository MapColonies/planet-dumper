import { validate } from 'node-cron';
import { CheckError } from '@common/errors';
import type { CheckFunc } from '@src/wrappers/check';
import type { ScheduleArguments } from '../scheduleFactory';

const CRON_EXPRESSION_CHECK_ARG = 'cron-expression';
const TARGET_CHECK_ARG = 'target';

export const cronExpressionCheck: CheckFunc<ScheduleArguments> = (argv) => {
  const { cronExpression } = argv;
  if (!validate(cronExpression)) {
    throw new CheckError(`${CRON_EXPRESSION_CHECK_ARG} is not a valid cron expression`, CRON_EXPRESSION_CHECK_ARG, cronExpression);
  }
  return true;
};

export const scheduleTargetOptionsCheck: CheckFunc<ScheduleArguments> = (argv) => {
  const { target, s3Endpoint, s3BucketName } = argv;
  if (target === 'create' && (s3Endpoint === undefined || s3BucketName === undefined)) {
    throw new CheckError('s3-endpoint and s3-bucket-name are required when target is "create"', TARGET_CHECK_ARG, target);
  }
  return true;
};
