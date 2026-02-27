type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  return value;
}

function readNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  if (typeof value !== "number") {
    return null;
  }

  return value;
}

function readPropertyUnknown(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return Reflect.get(value, key);
}

export function readApiErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const message = readString(record, "message");
  if (message !== null) {
    return message;
  }

  const nestedError = toRecord(record["error"]);
  if (nestedError === null) {
    return null;
  }

  return readString(nestedError, "message");
}

export function readHttpErrorStatus(value: unknown): number | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  return readNumber(record, "status") ?? readNumber(record, "statusCode");
}

export function readHttpErrorCode(value: unknown): string | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const code = readString(record, "code");
  if (code !== null) {
    return code;
  }

  const nestedError = toRecord(record["error"]);
  if (nestedError === null) {
    return null;
  }

  return readString(nestedError, "code");
}

export function readHttpErrorBody(value: unknown): unknown {
  return readPropertyUnknown(value, "body") ?? readPropertyUnknown(value, "data");
}

export type HttpApiErrorInput = {
  operation: string;
  status: number;
  body: unknown;
  message: string;
  code?: string | null;
};

export class HttpApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;
  readonly code: string | null;

  constructor(input: HttpApiErrorInput) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
    this.code = input.code ?? null;
  }
}

export function normalizeHttpApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): HttpApiErrorInput {
  const status = readHttpErrorStatus(input.error) ?? 500;
  const body = readHttpErrorBody(input.error);
  const message =
    readApiErrorMessage(input.error) ??
    (input.error instanceof Error ? input.error.message : null) ??
    input.fallbackMessage;

  return {
    operation: input.operation,
    status,
    body,
    message,
    code: readHttpErrorCode(input.error),
  };
}
