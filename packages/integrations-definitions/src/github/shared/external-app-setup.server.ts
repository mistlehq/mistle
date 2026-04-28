import {
  IntegrationConnectionMethodIds,
  type IntegrationExternalAppSetupCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  buildConvertedGitHubAppConnectionConfig,
  buildConvertedGitHubAppConnectionSecrets,
  buildGitHubAppInstallationUrl,
  buildGitHubAppManifest,
  buildGitHubAppManifestConversionUrl,
  buildGitHubAppManifestSubmissionUrl,
  GitHubAppManifestConversionMissingClientSecretError,
  GitHubAppManifestOwnerSchema,
  parseGitHubAppManifestConversionResponse,
} from "./app-manifest.js";
import type { GitHubConnectionConfig } from "./auth.js";
import { parseGitHubAppInstallationConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

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

export const GitHubExternalAppSetupCapability: IntegrationExternalAppSetupCapability<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
> = {
  flows: [
    {
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
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
        }

        const code = input.query.get("code");
        if (code === null || code.length === 0) {
          throw new Error("GitHub App setup callback query must include `code`.");
        }

        const conversion = await convertGitHubAppManifest({
          apiBaseUrl: input.target.config.apiBaseUrl,
          code,
        });

        try {
          return {
            connection: {
              config: buildConvertedGitHubAppConnectionConfig({ conversion }),
            },
            secrets: buildConvertedGitHubAppConnectionSecrets({
              conversion,
              supportsClientSecret: true,
            }),
          };
        } catch (error) {
          if (error instanceof GitHubAppManifestConversionMissingClientSecretError) {
            throw error;
          }

          throw error;
        }
      },
    },
    {
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      routeSegment: "github-app-installation",
      async start(input) {
        const parsedConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);
        await input.resolveConnectionSecret({
          slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
          secretKind: "api_key",
        });

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
          throw new Error("GitHub App installation callback query must include `installation_id`.");
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
