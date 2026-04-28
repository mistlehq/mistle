import {
  IntegrationConnectionMethodIds,
  type IntegrationProviderAppSetupCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  buildConvertedGitHubAppConnectionConfig,
  buildConvertedGitHubAppConnectionSecrets,
  buildGitHubAppInstallationUrl,
  buildGitHubAppManifest,
  buildGitHubAppManifestConversionUrl,
  buildGitHubAppManifestSubmissionUrl,
  buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata,
  GitHubAppManifestOwnerSchema,
  parseGitHubAppManifestConversionResponse,
} from "./app-manifest.js";
import type { GitHubConnectionConfig } from "./auth.js";
import { parseGitHubAppInstallationConnectionConfig } from "./auth.js";
import { GitHubCredentialSlotKeys } from "./slot-keys.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

type GitHubProviderAppSetupCapabilityOptions = {
  requiredInstallationSecrets: ReadonlyArray<{
    secretKind: "api_key" | "oauth2_client_secret";
    slotKey:
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_WEBHOOK_SECRET
      | typeof GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM
      | typeof GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_WEBHOOK_SECRET;
  }>;
  supportsClientSecret: boolean;
};

const GitHubAppManifestStartBodySchema = z
  .object({
    manifest: z.record(z.string(), z.unknown()),
    owner: GitHubAppManifestOwnerSchema,
  })
  .strict();

async function convertGitHubAppManifest(input: {
  apiBaseUrl: string;
  code: string;
}): Promise<ReturnType<typeof parseGitHubAppManifestConversionResponse>> {
  const response = await fetch(
    buildGitHubAppManifestConversionUrl({
      apiBaseUrl: input.apiBaseUrl,
      code: input.code,
    }),
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `GitHub App manifest conversion failed with status ${response.status.toString()}.${responseBody.length === 0 ? "" : ` Response body: ${responseBody}`}`,
    );
  }

  const responseJson: unknown = await response.json();
  return parseGitHubAppManifestConversionResponse(responseJson);
}

export function createGitHubProviderAppSetupCapability(
  options: GitHubProviderAppSetupCapabilityOptions,
): IntegrationProviderAppSetupCapability<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
> {
  return {
    flows: [
      {
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        requiresWebhookCallbackUrl: true,
        routeSegment: "github-app",
        async start(input) {
          const body = GitHubAppManifestStartBodySchema.parse(input.body);
          if (input.webhookCallbackUrl === undefined) {
            throw new Error(
              `GitHub App manifest setup for connection '${input.connection.id}' requires a webhook callback URL.`,
            );
          }

          const manifest = buildGitHubAppManifest({
            manifest: body.manifest,
            controlPlaneBaseUrl: input.controlPlaneBaseUrl,
            webhookCallbackUrl: input.webhookCallbackUrl,
          });

          return {
            webhookSource: {
              providerMetadata:
                buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata(manifest),
            },
            start: {
              kind: "form-post",
              submissionUrl: buildGitHubAppManifestSubmissionUrl({
                owner: body.owner,
                webBaseUrl: input.target.config.webBaseUrl,
                state: input.redirectState,
              }),
              fields: {
                manifest: JSON.stringify(manifest),
              },
            },
          };
        },
        async complete(input) {
          const installationId = input.query.get("installation_id");
          if (installationId !== null && installationId.length > 0) {
            const setupAction = input.query.get("setup_action");
            const parsedConfig = parseGitHubAppInstallationConnectionConfig(
              input.connection.config,
            );

            return {
              connection: {
                externalSubjectId: installationId,
                config: {
                  ...parsedConfig,
                  installation_id: installationId,
                  ...(setupAction === null ? {} : { setup_action: setupAction }),
                },
              },
            };
          }

          const code = input.query.get("code");
          if (code === null || code.length === 0) {
            throw new Error("GitHub App setup callback query must include `code`.");
          }

          const conversion = await convertGitHubAppManifest({
            apiBaseUrl: input.target.config.apiBaseUrl,
            code,
          });

          return {
            connection: {
              config: buildConvertedGitHubAppConnectionConfig({ conversion }),
            },
            secrets: buildConvertedGitHubAppConnectionSecrets({
              conversion,
              supportsClientSecret: options.supportsClientSecret,
            }),
          };
        },
      },
      {
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        routeSegment: "github-app-installation",
        async start(input) {
          const parsedConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);
          for (const secret of options.requiredInstallationSecrets) {
            await input.resolveConnectionSecret(secret);
          }

          return {
            start: {
              kind: "redirect",
              authorizationUrl: buildGitHubAppInstallationUrl({
                appSlug: parsedConfig.app_slug,
                state: input.redirectState,
                variantId: input.target.variantId,
                webBaseUrl: input.target.config.webBaseUrl,
              }),
            },
          };
        },
        async complete(input) {
          const installationId = input.query.get("installation_id");
          if (installationId === null || installationId.length === 0) {
            throw new Error(
              "GitHub App installation callback query must include `installation_id`.",
            );
          }

          const setupAction = input.query.get("setup_action");
          const parsedConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);

          return {
            connection: {
              externalSubjectId: installationId,
              config: {
                ...parsedConfig,
                installation_id: installationId,
                ...(setupAction === null ? {} : { setup_action: setupAction }),
              },
            },
          };
        },
      },
    ],
  };
}

export const GitHubCloudProviderAppSetupCapability = createGitHubProviderAppSetupCapability({
  requiredInstallationSecrets: [
    {
      slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM,
      secretKind: "api_key",
    },
    {
      slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
      secretKind: "oauth2_client_secret",
    },
    {
      slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_WEBHOOK_SECRET,
      secretKind: "api_key",
    },
  ],
  supportsClientSecret: true,
});

export const GitHubEnterpriseServerProviderAppSetupCapability =
  createGitHubProviderAppSetupCapability({
    requiredInstallationSecrets: [
      {
        slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM,
        secretKind: "api_key",
      },
      {
        slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_WEBHOOK_SECRET,
        secretKind: "api_key",
      },
    ],
    supportsClientSecret: false,
  });
