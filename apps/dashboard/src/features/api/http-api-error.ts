import { z } from "zod";

const NestedHttpErrorSchema = z
  .object({
    message: z.string().optional(),
    code: z.string().optional(),
  })
  .catchall(z.unknown());

const HttpErrorSchema = z
  .object({
    message: z.string().optional(),
    status: z.number().optional(),
    statusCode: z.number().optional(),
    code: z.string().optional(),
    body: z.unknown().optional(),
    data: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .catchall(z.unknown());

type HttpErrorRecord = z.infer<typeof HttpErrorSchema>;
type NestedHttpErrorRecord = z.infer<typeof NestedHttpErrorSchema>;

function parseHttpErrorRecord(value: unknown): HttpErrorRecord | null {
  const parsed = HttpErrorSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function parseNestedHttpErrorRecord(value: unknown): NestedHttpErrorRecord | null {
  const parsed = NestedHttpErrorSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readApiErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const record = parseHttpErrorRecord(value);
  if (record === null) {
    return null;
  }

  if (record.message !== undefined) {
    return record.message;
  }

  const nestedError = parseNestedHttpErrorRecord(record.error);
  if (nestedError !== null && nestedError.message !== undefined) {
    const message = nestedError.message;
    return message;
  }
  return null;
}

export function readHttpErrorStatus(value: unknown): number | null {
  if (
    value instanceof Error &&
    "status" in value &&
    typeof value.status === "number" &&
    Number.isInteger(value.status)
  ) {
    return value.status;
  }

  const record = parseHttpErrorRecord(value);
  if (record === null) {
    return null;
  }

  return record.status ?? record.statusCode ?? null;
}

export function readHttpErrorCode(value: unknown): string | null {
  const record = parseHttpErrorRecord(value);
  if (record === null) {
    return null;
  }

  if (record.code !== undefined) {
    return record.code;
  }

  const nestedError = parseNestedHttpErrorRecord(record.error);
  return nestedError?.code ?? null;
}

export function readHttpErrorBody(value: unknown): unknown {
  const record = parseHttpErrorRecord(value);
  if (record === null) {
    return null;
  }

  return record.body ?? record.data ?? record.error;
}

export function isUnavailableResourceError(value: unknown): boolean {
  return readHttpErrorStatus(value) === 404;
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
