import { readNumber, readString, toRecord } from "./members-records.js";

export function readErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  const record = toRecord(value);
  if (record === null) {
    return null;
  }
  const direct = readString(record, "message");
  if (direct !== null) {
    return direct;
  }
  const nestedError = toRecord(record["error"]);
  if (nestedError !== null) {
    const nestedMessage = readString(nestedError, "message");
    if (nestedMessage !== null) {
      return nestedMessage;
    }
  }
  return null;
}

export class MembersApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;

  constructor(input: { operation: string; status: number; body: unknown; message: string }) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
  }
}

function readPropertyNumber(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = Reflect.get(value, key);
  return typeof candidate === "number" ? candidate : null;
}

function readPropertyUnknown(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return Reflect.get(value, key);
}

function readErrorStatus(value: unknown): number | null {
  const status = readPropertyNumber(value, "status");
  if (status !== null) {
    return status;
  }

  return readPropertyNumber(value, "statusCode");
}

export function toMembersApiError(operation: string, error: unknown): MembersApiError {
  if (error instanceof MembersApiError) {
    return error;
  }

  const record = toRecord(error);
  const parsedStatus =
    readErrorStatus(error) ?? (record === null ? null : readNumber(record, "status"));
  const parsedBody =
    readPropertyUnknown(error, "body") ??
    readPropertyUnknown(error, "data") ??
    (record === null ? null : error);
  const parsedMessage =
    (record === null ? null : readErrorMessage(record)) ??
    (error instanceof Error ? error.message : null) ??
    `${operation} failed.`;

  if (parsedStatus !== null) {
    return new MembersApiError({
      operation,
      status: parsedStatus,
      body: parsedBody,
      message: parsedMessage,
    });
  }

  if (error instanceof Error) {
    return new MembersApiError({
      operation,
      status: 500,
      body: parsedBody,
      message: error.message,
    });
  }

  if (record !== null) {
    return new MembersApiError({
      operation,
      status: 500,
      body: parsedBody,
      message: parsedMessage,
    });
  }

  return new MembersApiError({
    operation,
    status: 500,
    body: null,
    message: `${operation} failed.`,
  });
}

export async function executeMembersOperation<T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    throw toMembersApiError(operation, error);
  }
}
