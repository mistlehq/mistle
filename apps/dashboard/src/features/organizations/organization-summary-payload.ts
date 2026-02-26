export type OrganizationSummary = {
  name: string;
  slug: string;
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
  const slug = readString(organization, "slug");
  if (name === null || slug === null) {
    throw new Error("Organization fields were missing.");
  }

  return {
    name,
    slug,
  };
}
