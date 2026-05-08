import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";

import type { IntegrationConnection } from "./integrations-service.js";

export type IntegrationConnectionNotice = {
  connectionId: string;
  message?: string;
  resetKey: string;
  title: string;
  variant: "alert" | "success";
};

export function resolveInstalledIntegrationConnectionNotice(input: {
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

  if (input.selectedConnection.connectionMethodId === SlackConnectionMethodId) {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `slack-installed:${input.detailConnectionId}`,
      title: "The Slack app was created and connected to Mistle successfully",
      variant: "success",
    };
  }

  if (
    input.selectedConnection.connectionMethodId ===
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `github-installed:${input.detailConnectionId}`,
      title: "GitHub App connected to Mistle successfully",
      variant: "success",
    };
  }

  return null;
}
