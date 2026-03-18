import {
  IntegrationConnectionMethodIds,
  type IntegrationCredentialResolver,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { createAppAuth, type InstallationAuthOptions } from "@octokit/auth-app";
import { request } from "@octokit/request";
import { z } from "zod";

import { GitHubConnectionConfigSchema, GitHubCredentialSecretTypes } from "./auth.js";
import { GitHubBindingConfigSchema } from "./binding-config-schema.js";

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
  repositoryNames?: ReadonlyArray<string>;
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

export function resolveGitHubInstallationRepositoryNames(
  input: IntegrationCredentialResolverInput,
): ReadonlyArray<string> | undefined {
  if (input.binding === undefined) {
    return undefined;
  }

  const parsedBindingConfig = GitHubBindingConfigSchema.parse(input.binding.config);
  const repositoryNames = parsedBindingConfig.repositories.map((repository) => {
    const repositorySegments = repository.split("/");
    const repositoryName = repositorySegments.at(-1);
    if (repositoryName === undefined || repositoryName.length === 0) {
      throw new Error(
        `GitHub app installation resolver requires repository selections in 'owner/name' format. Received '${repository}'.`,
      );
    }

    return repositoryName;
  });

  return [...new Set(repositoryNames)].sort((left, right) => left.localeCompare(right));
}

function resolveGitHubAppCredentialContext(
  input: IntegrationCredentialResolverInput,
): ResolvedGitHubAppCredentialContext {
  if (input.secretType !== GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN) {
    throw new Error(
      `GitHub app installation resolver only supports '${GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN}' secret type.`,
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
  if (
    parsedConnectionConfig.connection_method !==
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    throw new Error(
      "GitHub app installation resolver requires a GitHub App installation connection config.",
    );
  }

  const numericInstallationId = Number(parsedConnectionConfig.installation_id);
  if (!Number.isInteger(numericInstallationId) || numericInstallationId <= 0) {
    throw new Error("GitHub app installation resolver requires numeric `installation_id`.");
  }

  const repositoryNames = resolveGitHubInstallationRepositoryNames(input);

  return {
    apiBaseUrl: parsedTargetConfig.apiBaseUrl,
    appId,
    appPrivateKeyPem,
    installationId: numericInstallationId,
    ...(repositoryNames === undefined ? {} : { repositoryNames }),
  };
}

export function createGitHubInstallationAuthInput(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  installationId: number;
  repositoryNames?: ReadonlyArray<string>;
}): InstallationAuthOptions {
  return {
    type: "installation",
    installationId: input.installationId,
    ...(input.repositoryNames === undefined
      ? {}
      : {
          repositoryNames: [...input.repositoryNames],
        }),
  };
}

async function createGitHubInstallationAccessToken(input: {
  apiBaseUrl: string;
  appId: string;
  appPrivateKeyPem: string;
  installationId: number;
  repositoryNames?: ReadonlyArray<string>;
}): Promise<{ token: string; expiresAt?: string }> {
  const auth = createAppAuth({
    appId: input.appId,
    privateKey: input.appPrivateKeyPem,
    request: request.defaults({
      baseUrl: input.apiBaseUrl,
    }),
  });
  const authResult = await auth(createGitHubInstallationAuthInput(input));

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
      ...(resolvedContext.repositoryNames === undefined
        ? {}
        : {
            repositoryNames: resolvedContext.repositoryNames,
          }),
    });

    return {
      value: installationAccessToken.token,
      ...(installationAccessToken.expiresAt === undefined
        ? {}
        : { expiresAt: installationAccessToken.expiresAt }),
    };
  },
};
