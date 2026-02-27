export type OrganizationSummary = {
  name: string;
};

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

export function parseOrganizationSummary(value: unknown): OrganizationSummary {
  const organization = toRecord(value);
  if (organization === null) {
    throw new Error("Organization response was invalid.");
  }

  const name = readString(organization, "name");
  if (name === null) {
    throw new Error("Organization name was missing.");
  }

  return {
    name,
  };
}
