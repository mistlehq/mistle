import type { OrganizationRole } from "../members/members-api-types.js";
import type {
  OrganizationIdentityLinkProvider,
  OrganizationIdentityLinkProviderLink,
} from "./organization-identity-linking-service.js";

export type IdentityLinkEligibleConnection = {
  id: string;
  targetKey: string;
  displayName: string;
  connectionMethodId?: string;
  connectionMethodLabel?: string;
};

export type ReturnedIdentityLinkConnectionSelection = {
  providerFamily: string;
  integrationConnectionId: string;
};

type ProviderWithEligibleConnections = Pick<
  OrganizationIdentityLinkProvider,
  "eligibleConnections"
> &
  Record<string, unknown>;

type ProviderWithFamilyAndEligibleConnections = Pick<
  OrganizationIdentityLinkProvider,
  "providerFamily" | "eligibleConnections"
> &
  Record<string, unknown>;

export function canManageOrganizationIdentityLinking(input: {
  actorRole: OrganizationRole;
}): boolean {
  return input.actorRole === "owner" || input.actorRole === "admin";
}

export function formatIdentityLinkProviderConfigurationStatus(input: {
  configurationStatus: OrganizationIdentityLinkProvider["configurationStatus"];
}): string {
  switch (input.configurationStatus) {
    case "active":
      return "Enabled";
    case "disabled":
      return "Disabled";
    case "unconfigured":
      return "Not enabled";
  }
}

export function resolveIdentityLinkConfigureActionLabel(): string {
  return "Save";
}

export function resolveIdentityLinkStatusActionLabel(input: {
  configurationStatus: OrganizationIdentityLinkProvider["configurationStatus"];
}): string {
  switch (input.configurationStatus) {
    case "active":
      return "Disable";
    case "disabled":
      return "Enable";
    case "unconfigured":
      return "Enable";
  }
}

export function listEligibleIdentityLinkConnections(input: {
  provider: ProviderWithEligibleConnections;
}): readonly IdentityLinkEligibleConnection[] {
  return input.provider.eligibleConnections
    .map((connection) => ({
      id: connection.id,
      targetKey: connection.targetKey,
      displayName: connection.displayName,
      ...(connection.connectionMethodId === undefined
        ? {}
        : { connectionMethodId: connection.connectionMethodId }),
      ...(connection.connectionMethodLabel === undefined
        ? {}
        : { connectionMethodLabel: connection.connectionMethodLabel }),
    }))
    .sort((left, right) => {
      const displayNameOrder = left.displayName.localeCompare(right.displayName);
      if (displayNameOrder !== 0) {
        return displayNameOrder;
      }

      return left.id.localeCompare(right.id);
    });
}

export function formatIdentityLinkEligibleConnectionLabel(
  input: IdentityLinkEligibleConnection,
): string {
  if (input.connectionMethodLabel === undefined) {
    return input.displayName;
  }

  return `${input.displayName} · ${input.connectionMethodLabel}`;
}

export function resolveReturnedIdentityLinkConnectionSelection(input: {
  connectionId: string;
  providers: readonly ProviderWithFamilyAndEligibleConnections[];
}): ReturnedIdentityLinkConnectionSelection | null {
  for (const provider of input.providers) {
    const eligibleConnections = listEligibleIdentityLinkConnections({ provider });

    if (eligibleConnections.some((connection) => connection.id === input.connectionId)) {
      return {
        providerFamily: provider.providerFamily,
        integrationConnectionId: input.connectionId,
      };
    }
  }

  return null;
}

export function formatIdentityLinkProviderMemberStatus(input: { linked: boolean }): string {
  return input.linked ? "Linked" : "Not linked";
}

export function formatIdentityLinkProviderPrincipalSummary(input: {
  link: OrganizationIdentityLinkProviderLink;
}): string | null {
  if (input.link.principalSummary === null) {
    return null;
  }

  return (
    input.link.principalSummary.displayName ??
    input.link.principalSummary.login ??
    input.link.principalSummary.email ??
    input.link.principalSummary.providerSubjectId
  );
}
