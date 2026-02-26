import type { SessionData } from "../auth/types.js";

import { resolveErrorMessage } from "../auth/messages.js";

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

function readNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  if (typeof value !== "number") {
    return null;
  }

  return value;
}

export function resolveSessionFromAuthPayload(input: {
  data: SessionData;
  error: unknown;
}): SessionData {
  if (input.error === null) {
    return input.data;
  }

  const errorRecord = toRecord(input.error);
  const status = errorRecord === null ? null : readNumber(errorRecord, "status");

  if (status === 401) {
    return null;
  }

  throw new Error(resolveErrorMessage(errorRecord, "Unable to load session."));
}
