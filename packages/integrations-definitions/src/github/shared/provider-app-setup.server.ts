import {
  IntegrationConnectionMethodIds,
  type IntegrationProviderAppSetupCapability,
  type IntegrationProviderAppSetupCompleteResult,
  type IntegrationProviderAppSetupInstallationSelectionOption,
} from "@mistle/integrations-core";
import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import { Octokit } from "octokit";
import { z } from "zod";

import { GitHubApiVersion } from "./api-version.js";
import {
  buildConvertedGitHubAppConnectionConfig,
  buildConvertedGitHubAppConnectionSecrets,
  buildGitHubAppInstallationUrl,
  buildGitHubAppManifest,
  buildGitHubAppManifestConversionUrl,
  buildGitHubAppManifestSubmissionUrl,
  buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata,
  parseGitHubAppManifestConversionResponse,
} from "./app-manifest.js";
import type { GitHubConnectionConfig } from "./auth.js";
import { parseGitHubAppInstallationConnectionConfig } from "./auth.js";
import {
  GitHubAppInstallationCallbackRouteKey,
  GitHubAppManifestCallbackRouteKey,
} from "./provider-app-setup-routes.js";
import { GitHubCredentialSlotKeys } from "./slot-keys.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

type GitHubProviderAppSetupCapabilityOptions = {
  appPrivateKeySecret: {
    secretKind: "api_key";
    slotKey:
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM
      | typeof GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM;
  };
  requiredInstallationSecrets: ReadonlyArray<{
    secretKind: "api_key" | "oauth2_client_secret";
    slotKey:
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET
      | typeof GitHubCredentialSlotKeys.GITHUB_CLOUD_WEBHOOK_SECRET
      | typeof GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM
      | typeof GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_WEBHOOK_SECRET;
  }>;
  supportsStatelessInstallationCallbacks: boolean;
  supportsClientSecret: boolean;
};

const GitHubAppManifestStartBodySchema = z
  .object({
    manifest: z.record(z.string(), z.unknown()),
    organizationSlug: z.string().optional(),
    ownerKind: z.enum(["organization", "personal"]),
  })
  .strict()
  .transform((body) => ({
    manifest: body.manifest,
    owner:
      body.ownerKind === "personal"
        ? { kind: body.ownerKind }
        : {
            kind: body.ownerKind,
            organizationSlug: z.string().min(1).parse(body.organizationSlug),
          },
  }));

const GitHubAppInstallationResponseSchema = z
  .object({
    app_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    app_slug: z.string().min(1),
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
  })
  .loose();

const GitHubAppInstallationListItemSchema = z
  .object({
    account: z
      .object({
        avatar_url: z.string().optional(),
        login: z.string().min(1),
        type: z.string().min(1),
      })
      .loose(),
    app_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    app_slug: z.string().min(1),
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    repository_selection: z.string().min(1),
  })
  .loose();

const GitHubAppInstallationsResponseSchema = z.array(GitHubAppInstallationListItemSchema);

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

async function createGitHubAppAuthentication(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
}): Promise<string> {
  const appAuth = createAppAuth({
    appId: input.appId,
    privateKey: input.appPrivateKeyPem,
    request: request.defaults({
      baseUrl: input.apiBaseUrl,
    }),
  });
  const authentication = await appAuth({ type: "app" });
  return authentication.token;
}

function createGitHubAppOctokit(input: { apiBaseUrl: string; token: string }): Octokit {
  return new Octokit({
    auth: input.token,
    baseUrl: input.apiBaseUrl,
    request: {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": GitHubApiVersion,
      },
    },
  });
}

async function listGitHubAppInstallations(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  appSlug: string;
}): Promise<IntegrationProviderAppSetupInstallationSelectionOption[]> {
  const authenticationToken = await createGitHubAppAuthentication({
    apiBaseUrl: input.apiBaseUrl,
    appId: input.appId,
    appPrivateKeyPem: input.appPrivateKeyPem,
  });

  let responseJson: unknown;
  try {
    const octokit = createGitHubAppOctokit({
      apiBaseUrl: input.apiBaseUrl,
      token: authenticationToken,
    });
    responseJson = await octokit.paginate("GET /app/installations", {
      per_page: 100,
    });
  } catch (error) {
    throw new Error(
      `GitHub App installations could not be listed: ${
        error instanceof Error ? error.message : "GitHub API request failed."
      }`,
    );
  }

  const installations = GitHubAppInstallationsResponseSchema.parse(responseJson);
  return installations.map((installation) => {
    if (installation.app_id.toString() !== input.appId) {
      throw new Error(
        `GitHub App installation '${installation.id.toString()}' belongs to app '${installation.app_id.toString()}', expected '${input.appId}'.`,
      );
    }
    if (installation.app_slug !== input.appSlug) {
      throw new Error(
        `GitHub App installation '${installation.id.toString()}' belongs to app slug '${installation.app_slug}', expected '${input.appSlug}'.`,
      );
    }

    return {
      ...(installation.account.avatar_url === undefined ||
      installation.account.avatar_url.length === 0
        ? {}
        : { accountAvatarUrl: installation.account.avatar_url }),
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      installationId: installation.id.toString(),
      repositorySelection: installation.repository_selection,
    };
  });
}

function parseGitHubAppInstallationId(input: { installationId: string }): number {
  const numericInstallationId = Number(input.installationId);
  if (!Number.isInteger(numericInstallationId) || numericInstallationId <= 0) {
    throw new Error(
      "GitHub App installation callback query must include numeric `installation_id`.",
    );
  }

  return numericInstallationId;
}

async function verifyGitHubAppInstallation(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  appSlug: string;
  installationId: string;
}): Promise<void> {
  const numericInstallationId = parseGitHubAppInstallationId({
    installationId: input.installationId,
  });
  const authenticationToken = await createGitHubAppAuthentication({
    apiBaseUrl: input.apiBaseUrl,
    appId: input.appId,
    appPrivateKeyPem: input.appPrivateKeyPem,
  });

  let responseJson: unknown;
  try {
    const response = await request("GET /app/installations/{installation_id}", {
      baseUrl: input.apiBaseUrl,
      installation_id: numericInstallationId,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${authenticationToken}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    responseJson = response.data;
  } catch (error) {
    throw new Error(
      `GitHub App installation '${input.installationId}' could not be verified: ${
        error instanceof Error ? error.message : "GitHub API request failed."
      }`,
    );
  }

  const installation = GitHubAppInstallationResponseSchema.parse(responseJson);
  if (installation.id.toString() !== input.installationId) {
    throw new Error(
      `GitHub App installation verification returned installation '${installation.id.toString()}', expected '${input.installationId}'.`,
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
}

async function completeGitHubAppInstallation(input: {
  appPrivateKeyPem: string;
  connectionConfig: GitHubConnectionConfig;
  query: URLSearchParams;
  targetConfig: GitHubTargetConfig;
}): Promise<IntegrationProviderAppSetupCompleteResult> {
  const installationId = input.query.get("installation_id");
  if (installationId === null || installationId.length === 0) {
    throw new Error("GitHub App installation callback query must include `installation_id`.");
  }

  const setupAction = input.query.get("setup_action");
  const parsedConfig = parseGitHubAppInstallationConnectionConfig(input.connectionConfig);

  // GitHub documents `installation_id` on setup URL callbacks as spoofable:
  // https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/registering-a-github-app/about-the-setup-url
  // Verify the id with app authentication before storing it on the connection.
  await verifyGitHubAppInstallation({
    apiBaseUrl: input.targetConfig.apiBaseUrl,
    appId: parsedConfig.app_id,
    appPrivateKeyPem: input.appPrivateKeyPem,
    appSlug: parsedConfig.app_slug,
    installationId,
  });

  return {
    completionRedirect: {
      kind: "connection-detail",
      notice: "installed",
    },
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

export async function buildCompletedGitHubAppManifestResult(input: {
  conversion: ReturnType<typeof parseGitHubAppManifestConversionResponse>;
  query: URLSearchParams;
  supportsClientSecret: boolean;
  targetConfig: GitHubTargetConfig;
}): Promise<IntegrationProviderAppSetupCompleteResult> {
  const convertedConnectionConfig = parseGitHubAppInstallationConnectionConfig(
    buildConvertedGitHubAppConnectionConfig({
      conversion: input.conversion,
    }),
  );
  const convertedConnectionSecrets = buildConvertedGitHubAppConnectionSecrets({
    conversion: input.conversion,
    supportsClientSecret: input.supportsClientSecret,
  });

  const installationId = input.query.get("installation_id");
  if (installationId !== null && installationId.length > 0) {
    const appPrivateKeyPem = convertedConnectionSecrets["appPrivateKeyPem"];
    if (appPrivateKeyPem === undefined) {
      throw new Error("GitHub App manifest conversion did not return an app private key.");
    }

    const installationResult = await completeGitHubAppInstallation({
      appPrivateKeyPem,
      connectionConfig: convertedConnectionConfig,
      query: input.query,
      targetConfig: input.targetConfig,
    });

    return {
      ...installationResult,
      secrets: convertedConnectionSecrets,
    };
  }

  return {
    completionRedirect: {
      kind: "setup-route",
      query: {
        githubAppManifest: "created",
      },
    },
    connection: {
      config: convertedConnectionConfig,
    },
    secrets: convertedConnectionSecrets,
  };
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
        additionalCallbackRouteKeys: [GitHubAppInstallationCallbackRouteKey],
        callbackRouteKey: GitHubAppManifestCallbackRouteKey,
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
          if (input.callbackRouteKey === GitHubAppInstallationCallbackRouteKey) {
            const appPrivateKeyPem = await input.resolveConnectionSecret(
              options.appPrivateKeySecret,
            );

            return completeGitHubAppInstallation({
              appPrivateKeyPem,
              connectionConfig: input.connection.config,
              query: input.query,
              targetConfig: input.target.config,
            });
          }

          const code = input.query.get("code");
          if (code === null || code.length === 0) {
            throw new Error("GitHub App setup callback query must include `code`.");
          }

          const conversion = await convertGitHubAppManifest({
            apiBaseUrl: input.target.config.apiBaseUrl,
            code,
          });

          return buildCompletedGitHubAppManifestResult({
            conversion,
            query: input.query,
            supportsClientSecret: options.supportsClientSecret,
            targetConfig: input.target.config,
          });
        },
      },
      {
        callbackRouteKey: GitHubAppInstallationCallbackRouteKey,
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        routeSegment: GitHubAppInstallationCallbackRouteKey,
        resolveStatelessCallback(input) {
          if (
            !options.supportsStatelessInstallationCallbacks ||
            input.callbackRouteKey !== GitHubAppInstallationCallbackRouteKey
          ) {
            return undefined;
          }

          const installationId = input.query.get("installation_id");
          if (installationId === null || installationId.length === 0) {
            return undefined;
          }

          return {
            connectionConfigExternalSubjectField: "installation_id",
            externalSubjectId: installationId,
            routeSegment: GitHubAppInstallationCallbackRouteKey,
          };
        },
        async start(input) {
          const parsedConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);
          for (const secret of options.requiredInstallationSecrets) {
            await input.resolveConnectionSecret(secret);
          }
          if (
            parsedConfig.installation_id !== undefined &&
            parsedConfig.installation_id.trim().length > 0
          ) {
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
          }

          const appPrivateKeyPem = await input.resolveConnectionSecret(options.appPrivateKeySecret);
          const installations = await listGitHubAppInstallations({
            apiBaseUrl: input.target.config.apiBaseUrl,
            appId: parsedConfig.app_id,
            appPrivateKeyPem,
            appSlug: parsedConfig.app_slug,
          });

          if (installations.length === 1) {
            const installation = installations[0];
            if (installation === undefined) {
              throw new Error("GitHub App installation disappeared.");
            }

            const installationResult = await completeGitHubAppInstallation({
              appPrivateKeyPem,
              connectionConfig: parsedConfig,
              query: new URLSearchParams({
                installation_id: installation.installationId,
                setup_action: "select-existing-installation",
              }),
              targetConfig: input.target.config,
            });

            return {
              ...(installationResult.connection === undefined
                ? {}
                : { connection: installationResult.connection }),
              start: {
                kind: "completed",
                completionRedirect: installationResult.completionRedirect,
              },
            };
          }

          if (installations.length > 1) {
            return {
              start: {
                kind: "installation-selection",
                options: installations,
              },
            };
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
          const appPrivateKeyPem = await input.resolveConnectionSecret(options.appPrivateKeySecret);

          return completeGitHubAppInstallation({
            appPrivateKeyPem,
            connectionConfig: input.connection.config,
            query: input.query,
            targetConfig: input.target.config,
          });
        },
        async selectInstallation(input) {
          const appPrivateKeyPem = await input.resolveConnectionSecret(options.appPrivateKeySecret);

          return completeGitHubAppInstallation({
            appPrivateKeyPem,
            connectionConfig: input.connection.config,
            query: new URLSearchParams({
              installation_id: input.installationId,
              setup_action: "select-existing-installation",
            }),
            targetConfig: input.target.config,
          });
        },
      },
    ],
  };
}

export const GitHubCloudProviderAppSetupCapability = createGitHubProviderAppSetupCapability({
  appPrivateKeySecret: {
    slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM,
    secretKind: "api_key",
  },
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
  supportsStatelessInstallationCallbacks: true,
  supportsClientSecret: true,
});

export const GitHubEnterpriseServerProviderAppSetupCapability =
  createGitHubProviderAppSetupCapability({
    appPrivateKeySecret: {
      slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM,
      secretKind: "api_key",
    },
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
    supportsStatelessInstallationCallbacks: false,
    supportsClientSecret: false,
  });
