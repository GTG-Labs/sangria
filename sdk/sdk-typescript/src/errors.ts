export type SangriaOperation = "generate" | "settle";

interface SangriaErrorOptions {
  operation: SangriaOperation;
  cause?: unknown;
}

export class SangriaError extends Error {
  readonly operation: SangriaOperation;

  constructor(message: string, options: SangriaErrorOptions) {
    super(message);
    this.name = "SangriaError";
    this.operation = options.operation;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

interface SangriaConnectionErrorOptions extends SangriaErrorOptions {
  request?: Request;
}

export class SangriaConnectionError extends SangriaError {
  readonly request?: Request;

  constructor(message: string, options: SangriaConnectionErrorOptions) {
    super(message, options);
    this.name = "SangriaConnectionError";
    this.request = options.request;
  }
}

export class SangriaTimeoutError extends SangriaConnectionError {
  constructor(message: string, options: SangriaConnectionErrorOptions) {
    super(message, options);
    this.name = "SangriaTimeoutError";
  }
}

interface SangriaAPIStatusErrorOptions extends SangriaErrorOptions {
  response: Response;
  statusCode: number;
  request?: Request;
}

export class SangriaAPIStatusError extends SangriaError {
  readonly response: Response;
  readonly statusCode: number;
  readonly request?: Request;

  constructor(message: string, options: SangriaAPIStatusErrorOptions) {
    super(message, options);
    this.name = "SangriaAPIStatusError";
    this.response = options.response;
    this.statusCode = options.statusCode;
    this.request = options.request;
  }
}
