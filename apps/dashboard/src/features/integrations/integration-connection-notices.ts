import { resolveFormConnectionMethodProviderAppSetupInstalledNoticeTitle } from "./integration-connection-method-metadata.js";
import type { IntegrationConnectionMethod } from "./integrations-service-shared.js";
import type { IntegrationConnection } from "./integrations-service.js";

export type IntegrationConnectionNotice = {
  connectionId: string;
  message?: string;
  resetKey: string;
  title: string;
  variant: "alert" | "success";
};

export type ProviderAppSetupErrorNotice = {
  message: string;
  resetKey: string;
  title: string;
  variant: "alert";
};

export type TargetedProviderAppSetupErrorNotice = {
  notice: ProviderAppSetupErrorNotice;
  targetKey: string;
};

export function resolveProviderAppSetupErrorNotice(input: {
  searchParams: URLSearchParams;
}): ProviderAppSetupErrorNotice | null {
  if (input.searchParams.get("providerAppSetupError") !== "missing-state") {
    return null;
  }

  return {
    message:
      "GitHub did not return the setup state for this installation. Return to this screen and try connecting the GitHub App again.",
    resetKey: "provider-app-setup-error:missing-state",
    title: "GitHub App installation could not be completed",
    variant: "alert",
  };
}

export function resolveProviderAppSetupErrorConnectionNotice(input: {
  detailTargetKey: string | null;
  selectedConnection: Pick<IntegrationConnection, "id"> | undefined;
  urlProviderAppSetupErrorNotice: TargetedProviderAppSetupErrorNotice | null;
}): IntegrationConnectionNotice | null {
  if (
    input.urlProviderAppSetupErrorNotice === null ||
    input.selectedConnection === undefined ||
    input.urlProviderAppSetupErrorNotice.targetKey !== input.detailTargetKey
  ) {
    return null;
  }

  return {
    connectionId: input.selectedConnection.id,
    ...input.urlProviderAppSetupErrorNotice.notice,
  };
}

export function resolveInstalledIntegrationConnectionNotice(input: {
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  detailConnectionId: string | null;
  searchParams: URLSearchParams;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId" | "id"> | undefined;
}): IntegrationConnectionNotice | null {
  if (
    input.detailConnectionId === null ||
    input.selectedConnection?.id !== input.detailConnectionId
  ) {
    return null;
  }

  const connectionNotice = input.searchParams.get("connectionNotice");

  if (connectionNotice === "reauthorized") {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `reauthorized:${input.detailConnectionId}`,
      title: "Re-authorized",
      variant: "success",
    };
  }

  if (connectionNotice !== "installed") {
    return null;
  }

  const connectionMethodId = input.selectedConnection.connectionMethodId;
  if (connectionMethodId === undefined) {
    return null;
  }

  const connectionMethod =
    input.connectionMethods?.find((candidate) => candidate.id === connectionMethodId) ?? null;
  const installedNoticeTitle =
    resolveFormConnectionMethodProviderAppSetupInstalledNoticeTitle(connectionMethod);
  if (installedNoticeTitle === null) {
    return null;
  }

  return {
    connectionId: input.detailConnectionId,
    resetKey: `provider-app-installed:${connectionMethodId}:${input.detailConnectionId}`,
    title: installedNoticeTitle,
    variant: "success",
  };
}
