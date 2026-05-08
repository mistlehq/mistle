import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import {
  buildSlackAppManifestExportUrl,
  buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata,
  parseSlackManifestExportErrorResponse,
  parseSlackManifestExportSuccessResponse,
  type SlackManifestExportSuccessResponse,
} from "./app-manifest.js";
import { SlackAppConnectionConfigSchema, type SlackConnectionConfig } from "./auth.js";
import type { SlackTargetConfig } from "./target-config-schema.js";
import type { SlackTargetSecrets } from "./target-secret-schema.js";

const SlackWebhookTriggerCapabilitiesRefreshBodySchema = z
  .object({
    appConfigToken: z.string().min(1),
  })
  .strict();

async function exportSlackManifest(input: {
  apiBaseUrl: string;
  appConfigToken: string;
  appId: string;
}): Promise<SlackManifestExportSuccessResponse> {
  const response = await fetch(buildSlackAppManifestExportUrl({ apiBaseUrl: input.apiBaseUrl }), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.appConfigToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      app_id: input.appId,
    }),
  });

  const responseJson: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Slack app manifest export failed with status ${response.status.toString()}.`);
  }

  const errorResult = parseSlackManifestExportErrorResponse(responseJson);
  if (errorResult !== null) {
    throw new Error(`Slack app manifest export failed: ${errorResult.error}.`);
  }

  return parseSlackManifestExportSuccessResponse(responseJson);
}

export const SlackWebhookSourceCapability: IntegrationWebhookSourceCapability<
  SlackTargetConfig,
  SlackTargetSecrets,
  SlackConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Slack webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Slack Events API webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
  async refreshTriggerCapabilities(input) {
    const body = SlackWebhookTriggerCapabilitiesRefreshBodySchema.parse(input.body);
    const connectionConfig = SlackAppConnectionConfigSchema.parse(input.connection.config);
    const appId = connectionConfig.app_id;
    if (appId === undefined || appId.trim().length === 0) {
      throw new Error(`Integration connection '${input.connection.id}' is missing Slack app_id.`);
    }

    const exportedManifest = await exportSlackManifest({
      apiBaseUrl: input.target.config.apiBaseUrl,
      appConfigToken: body.appConfigToken.trim(),
      appId: appId.trim(),
    });
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Slack webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      providerMetadata: buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata({
        expectedRequestUrl: buildIntegrationWebhookCallbackUrl({
          controlPlaneBaseUrl: input.controlPlaneBaseUrl,
          targetKey: input.targetKey,
          endpointKey,
        }),
        manifest: exportedManifest.manifest,
      }),
    };
  },
};
