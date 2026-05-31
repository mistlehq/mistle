import { requestControlPlane } from "../../api/request-control-plane.js";

export type OAuthConsentDetails = {
  requestId: string;
  clientName: string;
  organizationName: string;
  resource: string;
  requestedScopes: readonly string[];
  authorizationRestartUri: string;
};

export type OAuthConsentOrganization = {
  id: string;
  name: string;
  role: string;
  isCurrent: boolean;
};

export async function getOAuthConsentDetails(input: {
  requestId: string;
  signal?: AbortSignal;
}): Promise<OAuthConsentDetails> {
  const response = await requestControlPlane({
    operation: "getOAuthConsentDetails",
    pathname: `/oauth/consent/${input.requestId}`,
    method: "GET",
    fallbackMessage: "Unable to load OAuth consent request.",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  return parseOAuthConsentDetails(await response.json());
}

export async function approveOAuthConsent(input: {
  requestId: string;
  scopes: readonly string[];
}): Promise<string> {
  const response = await requestControlPlane({
    operation: "approveOAuthConsent",
    pathname: `/oauth/consent/${input.requestId}/approve`,
    method: "POST",
    body: {
      scopes: [...input.scopes],
    },
    fallbackMessage: "Unable to approve OAuth consent request.",
  });

  return parseRedirectUri(await response.json());
}

export async function getOAuthConsentOrganizations(input: {
  signal?: AbortSignal;
}): Promise<OAuthConsentOrganization[]> {
  const response = await requestControlPlane({
    operation: "getOAuthConsentOrganizations",
    pathname: "/v1/me/organizations",
    method: "GET",
    fallbackMessage: "Unable to load organizations.",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  return parseOAuthConsentOrganizations(await response.json());
}

export async function denyOAuthConsent(input: { requestId: string }): Promise<string> {
  const response = await requestControlPlane({
    operation: "denyOAuthConsent",
    pathname: `/oauth/consent/${input.requestId}/deny`,
    method: "POST",
    fallbackMessage: "Unable to deny OAuth consent request.",
  });

  return parseRedirectUri(await response.json());
}

function parseOAuthConsentDetails(value: unknown): OAuthConsentDetails {
  const record = toRecord(value);
  const requestId = readString(record, "requestId");
  const clientName = readString(record, "clientName");
  const organizationName = readString(record, "organizationName");
  const resource = readString(record, "resource");
  const requestedScopes = readStringArray(record, "requestedScopes");
  const authorizationRestartUri = readString(record, "authorizationRestartUri");
  if (
    requestId === null ||
    clientName === null ||
    organizationName === null ||
    resource === null ||
    requestedScopes === null ||
    authorizationRestartUri === null
  ) {
    throw new Error("OAuth consent response was invalid.");
  }

  return {
    requestId,
    clientName,
    organizationName,
    resource,
    requestedScopes,
    authorizationRestartUri,
  };
}

function parseOAuthConsentOrganizations(value: unknown): OAuthConsentOrganization[] {
  const record = toRecord(value);
  const organizations = record.organizations;
  if (!Array.isArray(organizations)) {
    throw new Error("OAuth consent organizations response was invalid.");
  }

  return organizations.map((organization) => {
    const organizationRecord = toRecord(organization);
    const id = readString(organizationRecord, "id");
    const name = readString(organizationRecord, "name");
    const role = readString(organizationRecord, "role");
    const isCurrent = readBoolean(organizationRecord, "isCurrent");
    if (id === null || name === null || role === null || isCurrent === null) {
      throw new Error("OAuth consent organizations response included an invalid organization.");
    }

    return {
      id,
      name,
      role,
      isCurrent,
    };
  });
}

function parseRedirectUri(value: unknown): string {
  const redirectUri = readString(toRecord(value), "redirectUri");
  if (redirectUri === null) {
    throw new Error("OAuth consent redirect response was invalid.");
  }

  return redirectUri;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    return null;
  }
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    strings.push(item);
  }

  return strings;
}
