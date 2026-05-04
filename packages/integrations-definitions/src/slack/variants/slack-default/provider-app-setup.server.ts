import {
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
  type IntegrationProviderAppSetupCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  buildSlackAppInstallationCompleteUrl,
  buildSlackAppManifest,
  buildSlackAppManifestCreateUrl,
  buildSlackManifestConnectionConfig,
  buildSlackManifestConnectionSecrets,
  buildSlackOAuthAccessConnectionSecrets,
  buildSlackOAuthAccessUrl,
  parseSlackManifestCreateErrorResponse,
  parseSlackManifestCreateSuccessResponse,
  parseSlackOAuthAccessErrorResponse,
  parseSlackOAuthAccessSuccessResponse,
  type SlackManifestCreateSuccessResponse,
  type SlackOAuthAccessSuccessResponse,
} from "./app-manifest.js";
import {
  SlackAppConnectionConfigSchema,
  SlackConnectionMethodId,
  SlackCredentialSecretTypes,
  SlackCredentialSlotKeys,
  type SlackConnectionConfig,
} from "./auth.js";
import { SlackAppManifestBotEvents, SlackAppManifestBotScopes } from "./manifest.js";
import { SlackAppInstallationCallbackRouteKey } from "./provider-app-setup-routes.js";
import type { SlackTargetConfig } from "./target-config-schema.js";
import type { SlackTargetSecrets } from "./target-secret-schema.js";

const SlackAppManifestStartBodySchema = z
  .object({
    appConfigToken: z.string().min(1),
    manifest: z.record(z.string(), z.unknown()),
  })
  .strict();

async function createSlackManifest(input: {
  apiBaseUrl: string;
  appConfigToken: string;
  manifest: Record<string, unknown>;
}): Promise<SlackManifestCreateSuccessResponse> {
  const response = await fetch(buildSlackAppManifestCreateUrl({ apiBaseUrl: input.apiBaseUrl }), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.appConfigToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      manifest: JSON.stringify(input.manifest),
    }),
  });

  const responseJson: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      `Slack app manifest creation failed with status ${response.status.toString()}.`,
    );
  }

  const errorResult = parseSlackManifestCreateErrorResponse(responseJson);
  if (errorResult !== null) {
    const details =
      errorResult.errors === undefined
        ? ""
        : ` ${errorResult.errors
            .map((entry) =>
              entry.pointer === undefined ? entry.message : `${entry.pointer}: ${entry.message}`,
            )
            .join(" ")}`;
    throw new Error(`Slack app manifest creation failed: ${errorResult.error}.${details}`);
  }

  return parseSlackManifestCreateSuccessResponse(responseJson);
}

async function completeSlackOAuthAccess(input: {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUrl: string;
}): Promise<SlackOAuthAccessSuccessResponse> {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  body.set("client_secret", input.clientSecret);
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUrl);

  const response = await fetch(buildSlackOAuthAccessUrl({ apiBaseUrl: input.apiBaseUrl }), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const responseJson: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Slack OAuth installation failed with status ${response.status.toString()}.`);
  }

  const errorResult = parseSlackOAuthAccessErrorResponse(responseJson);
  if (errorResult !== null) {
    throw new Error(`Slack OAuth installation failed: ${errorResult.error}.`);
  }

  return parseSlackOAuthAccessSuccessResponse(responseJson);
}

export const SlackProviderAppSetupCapability: IntegrationProviderAppSetupCapability<
  SlackTargetConfig,
  SlackTargetSecrets,
  SlackConnectionConfig
> = {
  flows: [
    {
      callbackRouteKey: SlackAppInstallationCallbackRouteKey,
      methodId: SlackConnectionMethodId,
      requiresWebhookCallbackUrl: true,
      routeSegment: "slack-app",
      async start(input) {
        const body = SlackAppManifestStartBodySchema.parse(input.body);
        if (input.webhookCallbackUrl === undefined) {
          throw new Error(
            `Slack app manifest setup for connection '${input.connection.id}' requires a webhook callback URL.`,
          );
        }

        const manifest = buildSlackAppManifest({
          manifest: body.manifest,
          controlPlaneBaseUrl: input.controlPlaneBaseUrl,
          webhookCallbackUrl: input.webhookCallbackUrl,
        });
        const createdManifest = await createSlackManifest({
          apiBaseUrl: input.target.config.apiBaseUrl,
          appConfigToken: body.appConfigToken.trim(),
          manifest,
        });
        const authorizationUrl = new URL(createdManifest.oauth_authorize_url);
        authorizationUrl.searchParams.set("state", input.redirectState);
        authorizationUrl.searchParams.set(
          "redirect_uri",
          buildSlackAppInstallationCompleteUrl({
            controlPlaneBaseUrl: input.controlPlaneBaseUrl,
          }),
        );

        return {
          connection: {
            config: buildSlackManifestConnectionConfig({
              clientId: createdManifest.credentials.client_id,
            }),
          },
          secrets: buildSlackManifestConnectionSecrets({
            clientSecret: createdManifest.credentials.client_secret,
            signingSecret: createdManifest.credentials.signing_secret,
          }),
          webhookSource: {
            providerMetadata: {
              [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
                events: [...SlackAppManifestBotEvents],
                permissions: SlackAppManifestBotScopes.map((permission) => ({ permission })),
              },
            },
          },
          start: {
            kind: "redirect",
            authorizationUrl: authorizationUrl.toString(),
          },
        };
      },
      async complete(input) {
        const code = input.query.get("code");
        if (code === null || code.length === 0) {
          throw new Error("Slack app installation callback query must include `code`.");
        }

        const parsedConnectionConfig = SlackAppConnectionConfigSchema.parse(
          input.connection.config,
        );
        const clientId = parsedConnectionConfig.client_id;
        if (clientId === undefined || clientId.trim().length === 0) {
          throw new Error(
            `Integration connection '${input.connection.id}' is missing Slack client_id.`,
          );
        }

        const clientSecret = await input.resolveConnectionSecret({
          slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
          secretKind: SlackCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
        });
        const slackOAuthAccess = await completeSlackOAuthAccess({
          apiBaseUrl: input.target.config.apiBaseUrl,
          clientId: clientId.trim(),
          clientSecret,
          code,
          redirectUrl: buildSlackAppInstallationCompleteUrl({
            controlPlaneBaseUrl: input.controlPlaneBaseUrl,
          }),
        });

        return {
          completionRedirect: {
            kind: "connection-detail",
            notice: "installed",
          },
          connection: {
            externalSubjectId: slackOAuthAccess.team?.id ?? slackOAuthAccess.app_id ?? null,
          },
          secrets: buildSlackOAuthAccessConnectionSecrets({
            accessToken: slackOAuthAccess.access_token,
          }),
        };
      },
    },
  ],
};
