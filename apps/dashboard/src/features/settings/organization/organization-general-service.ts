import { authClient } from "../../../lib/auth/client.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

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

function parseOrganizationGeneral(value: unknown): { name: string; slug: string } {
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

export async function getOrganizationGeneral(input: {
  organizationId: string;
}): Promise<{ name: string; slug: string }> {
  return executeMembersOperation("getOrganizationGeneral", async () => {
    const result = await authClient.$fetch("/organization/get-full-organization", {
      method: "GET",
      throw: true,
      query: {
        organizationId: input.organizationId,
      },
    });
    return parseOrganizationGeneral(result);
  });
}

export async function updateOrganizationGeneral(input: {
  organizationId: string;
  name: string;
  slug: string;
}): Promise<void> {
  return executeMembersOperation("updateOrganizationGeneral", async () => {
    await authClient.$fetch("/organization/update", {
      method: "POST",
      throw: true,
      body: {
        organizationId: input.organizationId,
        data: {
          name: input.name,
          slug: input.slug,
        },
      },
    });
  });
}
