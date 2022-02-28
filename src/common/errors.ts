import { ExitCodes } from './constants';

export class ErrorWithExitCode extends Error {
  public constructor(message?: string, public exitCode: number = ExitCodes.GENERAL_ERROR) {
    super(message);
    this.exitCode = exitCode;
    Object.setPrototypeOf(this, ErrorWithExitCode.prototype);
  }
}

export class PgDumpError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.PG_DUMP_ERROR);
    Object.setPrototypeOf(this, PgDumpError.prototype);
  }
}

export class PlanetDumpNgError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.PLANET_DUMP_NG_ERROR);
    Object.setPrototypeOf(this, PlanetDumpNgError.prototype);
  }
}

export class S3Error extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.S3_ERROR);
    Object.setPrototypeOf(this, S3Error.prototype);
  }
}

export class BucketDoesNotExistError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.BUCKET_DOES_NOT_EXIST_ERROR);
    Object.setPrototypeOf(this, BucketDoesNotExistError.prototype);
  }
}

export class ObjectKeyAlreadyExistError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.OBJECT_KEY_ALREADY_EXIST_ERROR);
    Object.setPrototypeOf(this, ObjectKeyAlreadyExistError.prototype);
  }
}

export class HttpUpstreamUnavailableError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.REMOTE_SERVICE_UNAVAILABLE);
    Object.setPrototypeOf(this, HttpUpstreamUnavailableError.prototype);
  }
}

export class HttpUpstreamResponseError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.REMOTE_SERVICE_RESPONSE_ERROR);
    Object.setPrototypeOf(this, HttpUpstreamResponseError.prototype);
  }
}
