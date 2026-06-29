import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import { useState } from "react";

import { getDashboardStoryControlPlaneApiOrigin } from "../../storybook/dashboard-story-config.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import {
  createIntegrationStoryQueryClient,
  createIntegrationStoryTarget,
  IntegrationSetupRouteStory,
} from "./integration-setup-flow-story-support.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const ActiveConnectionStatus: IntegrationConnection["status"] = "active";

function getWasenderApiDefinitionOrThrow() {
  const definition = IntegrationRegistry.getDefinition({
    familyId: "wasenderapi",
    variantId: "wasenderapi-mcp",
  });

  if (definition === null || definition === undefined) {
    throw new Error("Missing WasenderAPI integration definition for Storybook.");
  }

  return definition;
}

const WasenderApiDefinition = getWasenderApiDefinitionOrThrow();
const WasenderApiTarget = createIntegrationStoryTarget({
  definition: WasenderApiDefinition,
  config: {},
});

export function createDraftWasenderApiConnection(input?: {
  configuredSecretNames?: readonly string[];
}): IntegrationConnection {
  return {
    id: "icn_wasenderapi_story_draft",
    targetKey: "wasenderapi-mcp",
    displayName: "WasenderAPI Production",
    status: ActiveConnectionStatus,
    connectionMethodId: "api-key",
    connectionMethodLabel: "Personal access token",
    config: {
      connection_method: "api-key",
    },
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

function createWasenderApiWebhookSource(input: {
  connection: IntegrationConnection;
}): IntegrationWebhookSource {
  return {
    id: "iws_wasenderapi_story",
    targetKey: "wasenderapi-mcp",
    integrationConnectionId: input.connection.id,
    displayName: "WasenderAPI webhook",
    endpointKey: "eps_wasenderapi_story",
    callbackUrl: `${getDashboardStoryControlPlaneApiOrigin()}/p/integration/webhooks/wasenderapi-mcp/eps_wasenderapi_story`,
    status: "active",
    providerMetadata: {},
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

export function WasenderApiSetupPageStory(input: {
  connection: IntegrationConnection;
  initialEntry?: string;
  webhookSource?: IntegrationWebhookSource;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createIntegrationStoryQueryClient({
      targets: [WasenderApiTarget],
      connections: [input.connection],
      webhookSources: [
        input.webhookSource ??
          createWasenderApiWebhookSource({
            connection: input.connection,
          }),
      ],
      organizationName: "Mistle",
    }),
  );

  return (
    <IntegrationSetupRouteStory
      initialEntries={[
        input.initialEntry ??
          "/integrations/wasenderapi-mcp/icn_wasenderapi_story_draft/provider-configuration/setup",
      ]}
      queryClient={queryClient}
      routeKind="setup"
    />
  );
}
