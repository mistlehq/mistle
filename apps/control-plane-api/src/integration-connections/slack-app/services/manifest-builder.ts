import { buildUrlWithPath } from "@mistle/http";
import {
  SlackAppManifestBotEvents,
  SlackAppManifestBotScopes,
} from "@mistle/integrations-definitions";

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

export function buildSlackAppManifest(input: {
  manifest: Record<string, unknown>;
  controlPlaneBaseUrl: string;
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
