import { buildUrlWithPath } from "@mistle/http";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { z } from "zod";

import { SlackConnectionMethodId } from "./auth.js";
import {
  SlackAppManifestBotEvents,
  SlackAppManifestBotScopes,
  SlackAppManifestTemplate,
} from "./manifest.js";
import { SlackAppInstallationSetupPath } from "./provider-app-setup-routes.js";

const SlackOAuthAccessSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    access_token: z.string().min(1),
    token_type: z.literal("bot").optional(),
    app_id: z.string().min(1).optional(),
    bot_user_id: z.string().min(1).optional(),
    team: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const SlackOAuthAccessErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
  })
  .loose();

const SlackManifestCreateSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    app_id: z.string().min(1),
    credentials: z
      .object({
        client_id: z.string().min(1),
        client_secret: z.string().min(1),
        signing_secret: z.string().min(1),
      })
      .loose(),
    oauth_authorize_url: z.url(),
  })
  .loose();

const SlackManifestCreateErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
    errors: z
      .array(
        z
          .object({
            message: z.string().min(1),
            pointer: z.string().min(1).optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const SlackManifestExportSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    manifest: z.record(z.string(), z.unknown()),
  })
  .loose();

const SlackManifestExportErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
  })
  .loose();

export type SlackOAuthAccessSuccessResponse = z.output<
  typeof SlackOAuthAccessSuccessResponseSchema
>;

export type SlackOAuthAccessErrorResponse = z.output<typeof SlackOAuthAccessErrorResponseSchema>;

export type SlackManifestCreateSuccessResponse = z.output<
  typeof SlackManifestCreateSuccessResponseSchema
>;

export type SlackManifestCreateErrorResponse = z.output<
  typeof SlackManifestCreateErrorResponseSchema
>;

export type SlackManifestExportSuccessResponse = z.output<
  typeof SlackManifestExportSuccessResponseSchema
>;

export type SlackManifestExportErrorResponse = z.output<
  typeof SlackManifestExportErrorResponseSchema
>;

const SlackAppManifestTemplateRedirectUrls = new Set(
  SlackAppManifestTemplate.oauth_config.redirect_urls,
);

const MistleOwnedSlackRedirectUrlPaths = new Set([
  SlackAppInstallationSetupPath,
  "/p/identity-linking/callbacks/slack",
]);

function mergeUniqueStrings(input: {
  excludedValues?: ReadonlySet<string>;
  existing: unknown;
  requiredValues: ReadonlyArray<string>;
}): string[] {
  const values =
    Array.isArray(input.existing) && input.existing.every((entry) => typeof entry === "string")
      ? input.existing
      : [];
  const excludedValues = input.excludedValues;
  const retainedValues =
    excludedValues === undefined ? values : values.filter((value) => !excludedValues.has(value));
  return [...new Set([...retainedValues, ...input.requiredValues])];
}

function removeMistleOwnedSlackRedirectUrls(values: readonly string[]): string[] {
  return values.filter(
    (value) =>
      !URL.canParse(value) || !MistleOwnedSlackRedirectUrlPaths.has(new URL(value).pathname),
  );
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
  return buildUrlWithPath(input.controlPlaneBaseUrl, SlackAppInstallationSetupPath);
}

export function buildSlackAppManifestCreateUrl(input: { apiBaseUrl: string }): string {
  return buildUrlWithPath(input.apiBaseUrl, "apps.manifest.create");
}

export function buildSlackAppManifestExportUrl(input: { apiBaseUrl: string }): string {
  return buildUrlWithPath(input.apiBaseUrl, "apps.manifest.export");
}

export function buildSlackOAuthAccessUrl(input: { apiBaseUrl: string }): string {
  return buildUrlWithPath(input.apiBaseUrl, "oauth.v2.access");
}

export function parseSlackOAuthAccessSuccessResponse(
  value: unknown,
): SlackOAuthAccessSuccessResponse {
  return SlackOAuthAccessSuccessResponseSchema.parse(value);
}

export function parseSlackOAuthAccessErrorResponse(
  value: unknown,
): SlackOAuthAccessErrorResponse | null {
  const parsed = SlackOAuthAccessErrorResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSlackManifestCreateSuccessResponse(
  value: unknown,
): SlackManifestCreateSuccessResponse {
  return SlackManifestCreateSuccessResponseSchema.parse(value);
}

export function parseSlackManifestCreateErrorResponse(
  value: unknown,
): SlackManifestCreateErrorResponse | null {
  const parsed = SlackManifestCreateErrorResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSlackManifestExportSuccessResponse(
  value: unknown,
): SlackManifestExportSuccessResponse {
  return SlackManifestExportSuccessResponseSchema.parse(value);
}

export function parseSlackManifestExportErrorResponse(
  value: unknown,
): SlackManifestExportErrorResponse | null {
  const parsed = SlackManifestExportErrorResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function buildSlackOAuthAccessConnectionSecrets(input: {
  accessToken: string;
}): Record<string, string> {
  return {
    botToken: input.accessToken,
  };
}

export function buildSlackManifestConnectionConfig(input: {
  appId: string;
  clientId: string;
}): Record<string, string> {
  return {
    connection_method: SlackConnectionMethodId,
    app_id: input.appId,
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

function resolveManifestObjectField(input: {
  fieldName: string;
  parent: Record<string, unknown>;
}): Record<string, unknown> {
  const value = input.parent[input.fieldName];
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Slack manifest field '${input.fieldName}' must be an object.`);
  }

  return Object.fromEntries(Object.entries(value));
}

function resolveOptionalManifestStringArray(input: {
  fieldName: string;
  parent: Record<string, unknown>;
}): string[] {
  const value = input.parent[input.fieldName];
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Slack manifest field '${input.fieldName}' must be an array.`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`Slack manifest field '${input.fieldName}' must contain strings.`);
    }

    return entry;
  });
}

function resolveManifestStringField(input: {
  fieldName: string;
  parent: Record<string, unknown>;
}): string {
  const value = input.parent[input.fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Slack manifest field '${input.fieldName}' must be a string.`);
  }

  return value;
}

export function buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata(input: {
  expectedRequestUrl: string;
  manifest: Record<string, unknown>;
}): Record<string, unknown> {
  const settings = resolveManifestObjectField({
    parent: input.manifest,
    fieldName: "settings",
  });
  const eventSubscriptions = resolveManifestObjectField({
    parent: settings,
    fieldName: "event_subscriptions",
  });
  const oauthConfig = resolveManifestObjectField({
    parent: input.manifest,
    fieldName: "oauth_config",
  });
  const scopes = resolveManifestObjectField({
    parent: oauthConfig,
    fieldName: "scopes",
  });
  const events = resolveOptionalManifestStringArray({
    parent: eventSubscriptions,
    fieldName: "bot_events",
  });
  const requestUrl = resolveManifestStringField({
    parent: eventSubscriptions,
    fieldName: "request_url",
  });
  if (requestUrl !== input.expectedRequestUrl) {
    throw new Error(
      `Slack Events API Request URL must be '${input.expectedRequestUrl}' before webhook events can be synced. Current Slack Request URL is '${requestUrl}'.`,
    );
  }

  const botScopes = resolveOptionalManifestStringArray({
    parent: scopes,
    fieldName: "bot",
  });

  return {
    [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
      events,
      permissions: botScopes.map((permission) => ({ permission })),
    },
  };
}

export function buildSlackAppManifest(input: {
  controlPlaneBaseUrl: string;
  manifest: Record<string, unknown>;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  const settings = toRecord(input.manifest["settings"]);
  const eventSubscriptions = toRecord(settings["event_subscriptions"]);
  const interactivity = toRecord(settings["interactivity"]);
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
      interactivity: {
        ...interactivity,
        is_enabled: true,
        request_url: input.webhookCallbackUrl,
      },
      socket_mode_enabled: false,
    },
    oauth_config: {
      ...oauthConfig,
      redirect_urls: mergeUniqueStrings({
        excludedValues: SlackAppManifestTemplateRedirectUrls,
        existing:
          Array.isArray(oauthConfig["redirect_urls"]) &&
          oauthConfig["redirect_urls"].every((entry) => typeof entry === "string")
            ? removeMistleOwnedSlackRedirectUrls(oauthConfig["redirect_urls"])
            : oauthConfig["redirect_urls"],
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

export function buildSlackAppManifestDraft(input: {
  controlPlaneBaseUrl: string;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  return buildSlackAppManifest({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    manifest: SlackAppManifestTemplate,
    webhookCallbackUrl: input.webhookCallbackUrl,
  });
}
