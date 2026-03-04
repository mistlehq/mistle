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
    error: NestedHttpErrorSchema.optional(),
  })
  .catchall(z.unknown());

type HttpErrorRecord = z.infer<typeof HttpErrorSchema>;

function parseHttpErrorRecord(value: unknown): HttpErrorRecord | null {
  const parsed = HttpErrorSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function readPropertyUnknown(value: unknown, key: "body" | "data"): unknown {
  const record = parseHttpErrorRecord(value);
  if (record === null) {
    return null;
  }

  return record[key];
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

  if (record.error !== undefined && record.error.message !== undefined) {
    const message = record.error.message;
    return message;
  }
  return null;
}

export function readHttpErrorStatus(value: unknown): number | null {
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

  return record.error?.code ?? null;
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
