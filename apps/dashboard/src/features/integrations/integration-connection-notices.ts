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

  if (input.searchParams.get("connectionNotice") !== "installed") {
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
