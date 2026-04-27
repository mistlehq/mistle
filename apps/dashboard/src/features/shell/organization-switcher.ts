import { authClient } from "../../lib/auth/client.js";

export type OrganizationSwitcherOption = {
  id: string;
  name: string;
};

export const ORGANIZATION_SWITCHER_QUERY_KEY = ["auth", "organizations"] as const;

const organizationSwitcherNameCollator = new Intl.Collator("en", {
  sensitivity: "base",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOrganizationSwitcherOption(value: unknown): OrganizationSwitcherOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const name = value.name;

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
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (!isRecord(error)) {
    return fallback;
  }

  const message = error.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  return fallback;
}

export function sortOrganizationSwitcherOptions(
  organizations: readonly OrganizationSwitcherOption[],
): OrganizationSwitcherOption[] {
  return [...organizations].sort((firstOrganization, secondOrganization) => {
    const nameComparison = organizationSwitcherNameCollator.compare(
      firstOrganization.name,
      secondOrganization.name,
    );

    if (nameComparison !== 0) {
      return nameComparison;
    }

    return firstOrganization.id.localeCompare(secondOrganization.id, "en");
  });
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

  const organizations = response.map((entry) => {
    const organization = parseOrganizationSwitcherOption(entry);
    if (organization === null) {
      throw new Error("Organization list response included an invalid organization.");
    }

    return organization;
  });

  return sortOrganizationSwitcherOptions(organizations);
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
