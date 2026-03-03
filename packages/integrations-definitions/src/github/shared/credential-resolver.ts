import {
  IntegrationSupportedAuthSchemes,
  type IntegrationCredentialResolver,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import { z } from "zod";

import { GitHubConnectionConfigSchema, GitHubCredentialSecretTypes } from "./auth.js";

export const GitHubCredentialResolverKeys: {
  GITHUB_APP_INSTALLATION_TOKEN: "github_app_installation_token";
} = {
  GITHUB_APP_INSTALLATION_TOKEN: "github_app_installation_token",
};

type ResolvedGitHubAppCredentialContext = {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  installationId: number;
};

const ResolvedGitHubTargetConfigSchema = z
  .object({
    apiBaseUrl: z.string().min(1),
    appId: z.string().min(1).optional(),
  })
  .loose();

const ResolvedGitHubTargetSecretsSchema = z
  .object({
    appPrivateKeyPem: z.string().min(1).optional(),
  })
  .loose();

function resolveGitHubAppCredentialContext(
  input: IntegrationCredentialResolverInput,
): ResolvedGitHubAppCredentialContext {
  if (input.secretType !== GitHubCredentialSecretTypes.OAUTH_ACCESS_TOKEN) {
    throw new Error(
      `GitHub app installation resolver only supports '${GitHubCredentialSecretTypes.OAUTH_ACCESS_TOKEN}' secret type.`,
    );
  }

  const parsedTargetConfig = ResolvedGitHubTargetConfigSchema.parse(input.target.config);
  const appId = parsedTargetConfig.appId;
  if (appId === undefined || appId.length === 0) {
    throw new Error("GitHub app installation resolver requires target config `app_id`.");
  }

  const parsedTargetSecrets = ResolvedGitHubTargetSecretsSchema.parse(input.target.secrets);
  const appPrivateKeyPem = parsedTargetSecrets.appPrivateKeyPem;
  if (appPrivateKeyPem === undefined || appPrivateKeyPem.length === 0) {
    throw new Error(
      "GitHub app installation resolver requires target secret `app_private_key_pem`.",
    );
  }

  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);
  if (parsedConnectionConfig.auth_scheme !== IntegrationSupportedAuthSchemes.OAUTH) {
    throw new Error("GitHub app installation resolver requires an OAuth connection config.");
  }

  const numericInstallationId = Number(parsedConnectionConfig.installation_id);
  if (!Number.isInteger(numericInstallationId) || numericInstallationId <= 0) {
    throw new Error("GitHub app installation resolver requires numeric `installation_id`.");
  }

  return {
    apiBaseUrl: parsedTargetConfig.apiBaseUrl,
    appId,
    appPrivateKeyPem,
    installationId: numericInstallationId,
  };
}

async function createGitHubInstallationAccessToken(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  installationId: number;
}): Promise<{ token: string; expiresAt?: string }> {
  const auth = createAppAuth({
    appId: input.appId,
    privateKey: input.appPrivateKeyPem,
    request: request.defaults({
      baseUrl: input.apiBaseUrl,
    }),
  });
  const authResult = await auth({
    type: "installation",
    installationId: input.installationId,
  });

  return {
    token: authResult.token,
    ...(authResult.expiresAt === undefined ? {} : { expiresAt: authResult.expiresAt }),
  };
}

export const GitHubAppInstallationCredentialResolver: IntegrationCredentialResolver = {
  async resolve(input) {
    const resolvedContext = resolveGitHubAppCredentialContext(input);
    const installationAccessToken = await createGitHubInstallationAccessToken({
      apiBaseUrl: resolvedContext.apiBaseUrl,
      appId: resolvedContext.appId,
      appPrivateKeyPem: resolvedContext.appPrivateKeyPem,
      installationId: resolvedContext.installationId,
    });

    return {
      value: installationAccessToken.token,
      ...(installationAccessToken.expiresAt === undefined
        ? {}
        : { expiresAt: installationAccessToken.expiresAt }),
    };
  },
};
