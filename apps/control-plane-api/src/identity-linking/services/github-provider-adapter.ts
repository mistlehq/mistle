import {
  IntegrationCredentialSecretKinds,
  type IntegrationConnection,
  type IntegrationTarget,
  UserExternalPrincipalCredentialSecretKinds,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  GitHubCredentialSlotKeys,
  GitHubTargetConfigSchema,
  parseGitHubAppInstallationConnectionConfig,
} from "@mistle/integrations-definitions";
import {
  GitHubIdentityLinkingAuthorizationError,
  completeGitHubLinkedAccountAuthorization,
  startGitHubLinkedAccountAuthorization,
} from "@mistle/integrations-definitions/server";
import { z } from "zod";

import { IdentityLinkingBadRequestCodes } from "../constants.js";
import type {
  CompletedLinkedAccountAuthorization,
  IdentityLinkProviderAdapter,
} from "./provider-adapters.js";
import { createRedirectState } from "./redirect-flow.js";
import { resolveConnectionSecretOrThrow } from "./resolve-connection-secret.js";

type ParsedGitHubAppConnectionConfig = ReturnType<
  typeof parseGitHubAppInstallationConnectionConfig
>;
type AdapterIntegrationsConfig = Parameters<
  IdentityLinkProviderAdapter["startAuthorization"]
>[0]["integrationsConfig"];
type AdapterDatabase = Parameters<IdentityLinkProviderAdapter["startAuthorization"]>[0]["db"];

function resolveGitHubAppConnectionConfigOrThrow(input: {
  connection: IntegrationConnection;
}): ParsedGitHubAppConnectionConfig {
  const parsedConnectionMethod = z
    .object({
      connection_method: z.string().min(1),
    })
    .loose()
    .safeParse(input.connection.config);

  if (!parsedConnectionMethod.success) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.connection.id}' has invalid GitHub App configuration.`,
    );
  }

  if (
    parsedConnectionMethod.data.connection_method !==
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.connection.id}' does not use GitHub App installation auth.`,
    );
  }

  try {
    return parseGitHubAppInstallationConnectionConfig(input.connection.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration connection '${input.connection.id}' has invalid GitHub App configuration.`,
      );
    }

    throw error;
  }
}

function resolveGitHubTargetConfigOrThrow(input: {
  target: IntegrationTarget;
}): z.output<typeof GitHubTargetConfigSchema> {
  try {
    return GitHubTargetConfigSchema.parse(input.target.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration target '${input.target.targetKey}' has invalid GitHub target config.`,
      );
    }

    throw error;
  }
}

function resolveGitHubClientIdOrThrow(input: {
  connection: IntegrationConnection;
  connectionConfig: ParsedGitHubAppConnectionConfig;
}): string {
  const clientId = input.connectionConfig.client_id?.trim();
  if (clientId === undefined || clientId.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.connection.id}' is missing GitHub App client_id.`,
    );
  }

  return clientId;
}

async function resolveGitHubClientSecretOrThrow(input: {
  db: AdapterDatabase;
  organizationId: string;
  connectionId: string;
  integrationsConfig: AdapterIntegrationsConfig;
}): Promise<string> {
  try {
    return await resolveConnectionSecretOrThrow({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      integrationsConfig: input.integrationsConfig,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration connection '${input.connectionId}' is missing GitHub App client secret.`,
      );
    }

    throw error;
  }
}

function toCompletedLinkedAccountAuthorization(
  input: Awaited<ReturnType<typeof completeGitHubLinkedAccountAuthorization>>,
): CompletedLinkedAccountAuthorization {
  const [firstKey, ...restKeys] = input.keys;

  return {
    providerSubjectId: input.providerSubjectId,
    profile: input.profile,
    keys: [
      {
        keyType: firstKey.keyType,
        keyValue: firstKey.keyValue,
      },
      ...restKeys.map((key) => ({
        keyType: key.keyType,
        keyValue: key.keyValue,
      })),
    ],
    credential: {
      credentialKind: "github_app_user_access_token",
      ...(input.credential.scopes === undefined ? {} : { scopes: input.credential.scopes }),
      ...(input.credential.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: input.credential.accessTokenExpiresAt }),
      ...(input.credential.refreshTokenExpiresAt === undefined
        ? {}
        : { refreshTokenExpiresAt: input.credential.refreshTokenExpiresAt }),
      secrets: [
        {
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          plaintext: input.credential.accessToken,
        },
        {
          secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
          plaintext: input.credential.refreshToken,
        },
      ],
    },
  };
}

export const GitHubIdentityLinkProviderAdapter: IdentityLinkProviderAdapter = {
  async startAuthorization(input) {
    const connectionConfig = resolveGitHubAppConnectionConfigOrThrow({
      connection: input.integrationConnection,
    });
    const targetConfig = resolveGitHubTargetConfigOrThrow({
      target: input.integrationTarget,
    });
    const clientId = resolveGitHubClientIdOrThrow({
      connection: input.integrationConnection,
      connectionConfig,
    });

    await resolveGitHubClientSecretOrThrow({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.integrationConnection.id,
      integrationsConfig: input.integrationsConfig,
    });

    const pkceVerifier = createRedirectState();
    const startedAuthorization = startGitHubLinkedAccountAuthorization({
      webBaseUrl: targetConfig.webBaseUrl,
      clientId,
      state: input.state,
      redirectUrl: input.redirectUrl,
      pkceVerifier,
    });

    return {
      authorizationUrl: startedAuthorization.authorizationUrl,
      pkceVerifier,
    };
  },
  async completeAuthorization(input) {
    if (input.pkceVerifier === undefined) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
        "GitHub linked-account callback is missing the PKCE verifier.",
      );
    }

    const connectionConfig = resolveGitHubAppConnectionConfigOrThrow({
      connection: input.integrationConnection,
    });
    const targetConfig = resolveGitHubTargetConfigOrThrow({
      target: input.integrationTarget,
    });
    const clientId = resolveGitHubClientIdOrThrow({
      connection: input.integrationConnection,
      connectionConfig,
    });
    const clientSecret = await resolveGitHubClientSecretOrThrow({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.integrationConnection.id,
      integrationsConfig: input.integrationsConfig,
    });

    try {
      const completedAuthorization = await completeGitHubLinkedAccountAuthorization({
        apiBaseUrl: targetConfig.apiBaseUrl,
        webBaseUrl: targetConfig.webBaseUrl,
        clientId,
        clientSecret,
        query: input.query,
        redirectUrl: input.redirectUrl,
        pkceVerifier: input.pkceVerifier,
        now: new Date().toISOString(),
      });

      return toCompletedLinkedAccountAuthorization(completedAuthorization);
    } catch (error) {
      if (error instanceof GitHubIdentityLinkingAuthorizationError) {
        throw new BadRequestError(
          IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
          error.message,
        );
      }

      throw error;
    }
  },
};
