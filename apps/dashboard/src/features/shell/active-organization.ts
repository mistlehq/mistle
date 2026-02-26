type UnknownRecord = Record<string, unknown>;

export const MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE =
  "No active organization is available in the current session.";

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

export function resolveActiveOrganizationIdFromSession(session: unknown): string | null {
  const sessionRecord = toRecord(session);
  if (sessionRecord === null) {
    return null;
  }

  const nestedSession = toRecord(sessionRecord["session"]);
  if (nestedSession === null) {
    return null;
  }

  const activeOrganizationId = readString(nestedSession, "activeOrganizationId");
  if (activeOrganizationId === null || activeOrganizationId.length === 0) {
    return null;
  }

  return activeOrganizationId;
}

export function requireActiveOrganizationId(organizationId: string | null): string {
  if (organizationId === null) {
    throw new Error(MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE);
  }

  return organizationId;
}
