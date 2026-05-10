import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
  type IntegrationWebhookTriggerProviderPermissionRequirement,
} from "@mistle/integrations-core";
import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import { z } from "zod";

import { buildIntegrationWebhookCallbackUrl } from "../../shared/webhook-callback-url.server.js";
import type { GitHubConnectionConfig } from "./auth.js";
import { parseGitHubAppInstallationConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

const GitHubWebhookTriggerCapabilitiesRefreshBodySchema = z.object({}).strict();

const GitHubAppInstallationTriggerCapabilitiesResponseSchema = z
  .object({
    app_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    app_slug: z.string().min(1),
    events: z.array(z.string().min(1)),
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    permissions: z.record(z.string().min(1), z.string().min(1)),
  })
  .loose();

const GitHubAppWebhookConfigResponseSchema = z
  .object({
    content_type: z.string().min(1),
    url: z.url(),
  })
  .loose();

function isGitHubAppInstallationConnection(connection: GitHubConnectionConfig): boolean {
  return connection.connection_method === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION;
}

function expandGitHubPermissionCapability(input: {
  access: string;
  permission: string;
}): readonly IntegrationWebhookTriggerProviderPermissionRequirement[] {
  if (input.access === "admin") {
    return [
      { permission: input.permission, access: "admin" },
      { permission: input.permission, access: "write" },
      { permission: input.permission, access: "read" },
    ];
  }

  if (input.access === "write") {
    return [
      { permission: input.permission, access: "write" },
      { permission: input.permission, access: "read" },
    ];
  }

  return [{ permission: input.permission, access: input.access }];
}

async function loadVerifiedGitHubAppTriggerCapabilities(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  appSlug: string;
  expectedWebhookUrl: string;
  installationId: string;
}): Promise<Record<string, unknown>> {
  const numericInstallationId = Number(input.installationId);
  if (!Number.isInteger(numericInstallationId) || numericInstallationId <= 0) {
    throw new Error("GitHub App connection is missing a numeric installation_id.");
  }

  const appAuth = createAppAuth({
    appId: input.appId,
    privateKey: input.appPrivateKeyPem,
    request: request.defaults({
      baseUrl: input.apiBaseUrl,
    }),
  });
  const authentication = await appAuth({ type: "app" });
  const appRequestHeaders = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${authentication.token}`,
    "x-github-api-version": "2022-11-28",
  } as const;

  let installationResponseJson: unknown;
  try {
    const installationResponse = await request("GET /app/installations/{installation_id}", {
      baseUrl: input.apiBaseUrl,
      installation_id: numericInstallationId,
      headers: appRequestHeaders,
    });
    installationResponseJson = installationResponse.data;
  } catch (error) {
    throw new Error(
      `GitHub App installation '${input.installationId}' trigger capabilities could not be refreshed: ${
        error instanceof Error ? error.message : "GitHub API request failed."
      }`,
    );
  }

  let hookConfigResponseJson: unknown;
  try {
    const hookConfigResponse = await request("GET /app/hook/config", {
      baseUrl: input.apiBaseUrl,
      headers: appRequestHeaders,
    });
    hookConfigResponseJson = hookConfigResponse.data;
  } catch (error) {
    throw new Error(
      `GitHub App webhook config for installation '${input.installationId}' could not be refreshed: ${
        error instanceof Error ? error.message : "GitHub API request failed."
      }`,
    );
  }

  const installation =
    GitHubAppInstallationTriggerCapabilitiesResponseSchema.parse(installationResponseJson);
  if (installation.id.toString() !== input.installationId) {
    throw new Error(
      `GitHub App installation refresh returned installation '${installation.id.toString()}', expected '${input.installationId}'.`,
    );
  }
  if (installation.app_id.toString() !== input.appId) {
    throw new Error(
      `GitHub App installation '${input.installationId}' belongs to app '${installation.app_id.toString()}', expected '${input.appId}'.`,
    );
  }
  if (installation.app_slug !== input.appSlug) {
    throw new Error(
      `GitHub App installation '${input.installationId}' belongs to app slug '${installation.app_slug}', expected '${input.appSlug}'.`,
    );
  }

  const hookConfig = GitHubAppWebhookConfigResponseSchema.parse(hookConfigResponseJson);
  if (hookConfig.url !== input.expectedWebhookUrl) {
    throw new Error(
      `GitHub App webhook URL is '${hookConfig.url}', expected '${input.expectedWebhookUrl}'. Update the GitHub App webhook URL, then sync again.`,
    );
  }
  if (hookConfig.content_type !== "json") {
    throw new Error(
      `GitHub App webhook content type is '${hookConfig.content_type}', expected 'json'. Set the GitHub App webhook content type to JSON, then sync again.`,
    );
  }

  return {
    [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
      events: installation.events,
      permissions: Object.entries(installation.permissions).flatMap(([permission, access]) =>
        expandGitHubPermissionCapability({ permission, access }),
      ),
    },
  };
}

export const GitHubWebhookSourceCapability: IntegrationWebhookSourceCapability<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  supportsConnection(input) {
    return isGitHubAppInstallationConnection(input.connection.config);
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`GitHub webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "GitHub App webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
  async refreshTriggerCapabilities(input) {
    GitHubWebhookTriggerCapabilitiesRefreshBodySchema.parse(input.body);

    const connectionConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);
    const installationId = connectionConfig.installation_id;
    if (installationId === undefined || installationId.trim().length === 0) {
      throw new Error(
        `Integration connection '${input.connection.id}' is missing installation_id.`,
      );
    }

    const appPrivateKeyPem = input.connectionSecrets?.["appPrivateKeyPem"];
    if (appPrivateKeyPem === undefined || appPrivateKeyPem.trim().length === 0) {
      throw new Error(
        `Integration connection '${input.connection.id}' is missing GitHub App private key.`,
      );
    }

    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`GitHub webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      providerMetadata: await loadVerifiedGitHubAppTriggerCapabilities({
        apiBaseUrl: input.target.config.apiBaseUrl,
        appId: connectionConfig.app_id,
        appPrivateKeyPem,
        appSlug: connectionConfig.app_slug,
        expectedWebhookUrl: buildIntegrationWebhookCallbackUrl({
          controlPlaneBaseUrl: input.controlPlaneBaseUrl,
          targetKey: input.targetKey,
          endpointKey,
        }),
        installationId: installationId.trim(),
      }),
    };
  },
};
