import type {
  KeysetPageCursor,
  KeysetPreviousPageCursor,
  SandboxProfile,
  SandboxProfilesListResult,
  SandboxProfileStatus,
} from "./sandbox-profiles-types.js";

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

function readSandboxProfileStatus(value: unknown): SandboxProfileStatus | null {
  if (value === "active" || value === "inactive") {
    return value;
  }

  return null;
}

function parseNextPage(value: unknown): KeysetPageCursor | null {
  if (value === null) {
    return null;
  }

  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const after = readString(record, "after");
  const limit = readNumber(record, "limit");
  if (after === null || limit === null) {
    return null;
  }

  return {
    after,
    limit,
  };
}

function parsePreviousPage(value: unknown): KeysetPreviousPageCursor | null {
  if (value === null) {
    return null;
  }

  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const before = readString(record, "before");
  const limit = readNumber(record, "limit");
  if (before === null || limit === null) {
    return null;
  }

  return {
    before,
    limit,
  };
}

export function parseSandboxProfile(value: unknown): SandboxProfile | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const id = readString(record, "id");
  const organizationId = readString(record, "organizationId");
  const displayName = readString(record, "displayName");
  const status = readSandboxProfileStatus(record["status"]);
  const createdAt = readString(record, "createdAt");
  const updatedAt = readString(record, "updatedAt");

  if (
    id === null ||
    organizationId === null ||
    displayName === null ||
    status === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    id,
    organizationId,
    displayName,
    status,
    createdAt,
    updatedAt,
  };
}

export function parseSandboxProfilesListResult(value: unknown): SandboxProfilesListResult | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const totalResults = readNumber(record, "totalResults");
  const itemsValue = record["items"];
  if (totalResults === null || !Array.isArray(itemsValue)) {
    return null;
  }

  const items: SandboxProfile[] = [];
  for (const item of itemsValue) {
    const parsedItem = parseSandboxProfile(item);
    if (parsedItem === null) {
      return null;
    }

    items.push(parsedItem);
  }

  const nextPage = parseNextPage(record["nextPage"]);
  const previousPage = parsePreviousPage(record["previousPage"]);

  if (record["nextPage"] !== null && nextPage === null) {
    return null;
  }

  if (record["previousPage"] !== null && previousPage === null) {
    return null;
  }

  return {
    totalResults,
    items,
    nextPage,
    previousPage,
  };
}

export function readSandboxProfilesErrorMessage(value: unknown): string | null {
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

  const error = toRecord(record["error"]);
  if (error === null) {
    return null;
  }

  return readString(error, "message");
}
