import { authClient } from "../../lib/auth/client.js";
type UnknownRecord = Record<string, unknown>;

export type OrganizationSwitcherOption = {
  id: string;
  name: string;
};

export const ORGANIZATION_SWITCHER_QUERY_KEY = ["auth", "organizations"] as const;

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

function parseOrganizationSwitcherOption(value: unknown): OrganizationSwitcherOption | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const id = record.id;
  const name = record.name;

  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  return {
    id,
    name,
  };
}

function resolveOrganizationSwitcherErrorMessage(error: unknown, fallback: string): string {
  const record = toRecord(error);
  if (record === null) {
    return fallback;
  }

  const message = record.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  return fallback;
}

export async function fetchOrganizationSwitcherOptions(): Promise<OrganizationSwitcherOption[]> {
  let response: unknown;

  try {
    response = await authClient.$fetch("/organization/list", {
      method: "GET",
      throw: true,
    });
  } catch (error) {
    throw new Error(
      resolveOrganizationSwitcherErrorMessage(error, "Unable to load organizations."),
    );
  }

  if (!Array.isArray(response)) {
    throw new Error("Organization list response must be an array.");
  }

  return response.map((entry) => {
    const organization = parseOrganizationSwitcherOption(entry);
    if (organization === null) {
      throw new Error("Organization list response included an invalid organization.");
    }

    return organization;
  });
}

export async function switchActiveOrganization(input: { organizationId: string }): Promise<void> {
  try {
    await authClient.$fetch("/organization/set-active", {
      method: "POST",
      throw: true,
      body: {
        organizationId: input.organizationId,
      },
    });
  } catch (error) {
    throw new Error(
      resolveOrganizationSwitcherErrorMessage(error, "Unable to switch organization."),
    );
  }
}
