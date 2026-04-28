import { buildUrlWithPath } from "@mistle/http";

import { SlackConnectionMethodId } from "./auth.js";
import { SlackAppManifestBotEvents, SlackAppManifestBotScopes } from "./manifest.js";

function mergeUniqueStrings(input: {
  existing: unknown;
  requiredValues: ReadonlyArray<string>;
}): string[] {
  const values =
    Array.isArray(input.existing) && input.existing.every((entry) => typeof entry === "string")
      ? input.existing
      : [];
  return [...new Set([...values, ...input.requiredValues])];
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function buildSlackAppInstallationCompleteUrl(input: {
  controlPlaneBaseUrl: string;
}): string {
  return buildUrlWithPath(
    input.controlPlaneBaseUrl,
    "/p/integration/callbacks/slack-app-installation",
  );
}

export function buildSlackAppManifestCreateUrl(input: { apiBaseUrl: string }): string {
  return buildUrlWithPath(input.apiBaseUrl, "apps.manifest.create");
}

export function buildSlackOAuthAccessUrl(input: { apiBaseUrl: string }): string {
  return buildUrlWithPath(input.apiBaseUrl, "oauth.v2.access");
}

export function buildSlackManifestConnectionConfig(input: {
  clientId: string;
}): Record<string, string> {
  return {
    connection_method: SlackConnectionMethodId,
    client_id: input.clientId,
  };
}

export function buildSlackManifestConnectionSecrets(input: {
  clientSecret: string;
  signingSecret: string;
}): Record<string, string> {
  return {
    clientSecret: input.clientSecret,
    signingSecret: input.signingSecret,
  };
}

export function buildSlackAppManifest(input: {
  controlPlaneBaseUrl: string;
  manifest: Record<string, unknown>;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  const settings = toRecord(input.manifest["settings"]);
  const eventSubscriptions = toRecord(settings["event_subscriptions"]);
  const oauthConfig = toRecord(input.manifest["oauth_config"]);
  const scopes = toRecord(oauthConfig["scopes"]);
  const redirectUrl = buildSlackAppInstallationCompleteUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
  });

  return {
    ...input.manifest,
    settings: {
      ...settings,
      event_subscriptions: {
        ...eventSubscriptions,
        request_url: input.webhookCallbackUrl,
        bot_events: mergeUniqueStrings({
          existing: eventSubscriptions["bot_events"],
          requiredValues: SlackAppManifestBotEvents,
        }),
      },
      socket_mode_enabled: false,
    },
    oauth_config: {
      ...oauthConfig,
      redirect_urls: mergeUniqueStrings({
        existing: oauthConfig["redirect_urls"],
        requiredValues: [
          redirectUrl,
          buildUrlWithPath(input.controlPlaneBaseUrl, "/p/identity-linking/callbacks/slack"),
        ],
      }),
      scopes: {
        ...scopes,
        bot: mergeUniqueStrings({
          existing: scopes["bot"],
          requiredValues: SlackAppManifestBotScopes,
        }),
      },
    },
  };
}
