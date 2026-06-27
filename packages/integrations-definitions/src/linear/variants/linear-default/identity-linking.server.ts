import { createHash, randomBytes } from "node:crypto";

import type { IntegrationIdentityLinkingCapability } from "@mistle/integrations-core";
import type {
  CompletedIdentityLinkingAuthorization,
  RefreshedIdentityLinkingCredential,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type LinearConnectionConfig,
  LinearConnectionMethodIds,
  LinearCredentialSlotKeys,
  LinearOAuthAppConnectionConfigSchema,
} from "./auth.js";
import {
  buildLinearAuthorizationCodeExchangeRequestBody,
  buildLinearAuthorizationUrl,
  buildLinearRefreshRequestBody,
  resolveLinearAccessTokenExpiresAt,
  resolveLinearAuthorizationCodeOrThrow,
} from "./oauth2-authorization-code.server.js";
import type { LinearTargetConfig } from "./target-config-schema.js";

const LinearGraphqlEndpoint = "https://api.linear.app/graphql";
const LinearTokenEndpoint = "https://api.linear.app/oauth/token";
const LinearLinkedUserCredentialKind = "linear_oauth_user_token";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const LinearTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: StringOrNumberSchema.optional(),
    refresh_token: z.string().min(1).optional(),
    scope: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const LinearGraphqlErrorSchema = z
  .object({
    message: z.string().min(1),
  })
  .loose();

const LinearViewerResponseSchema = z
  .object({
    data: z
      .object({
        viewer: z
          .object({
            id: z.string().min(1),
            name: z.string().min(1).nullable().optional(),
            email: z.email().nullable().optional(),
          })
          .loose()
          .nullable()
          .optional(),
      })
      .loose()
      .optional(),
    errors: z.array(LinearGraphqlErrorSchema).optional(),
  })
  .loose();

type LinearTokenResponse = z.output<typeof LinearTokenResponseSchema>;

export type LinearLinkedAccountAuthorizationResult = {
  providerSubjectId: string;
  profile: {
    displayName?: string;
    email?: string;
  };
  keys: readonly [
    {
      keyType: "user_id";
      keyValue: string;
    },
  ];
  credential: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt?: string;
    scopes?: string[];
  };
};

export class LinearIdentityLinkingAuthorizationError extends Error {
  readonly code = "IDENTITY_LINKING_AUTHORIZATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "LinearIdentityLinkingAuthorizationError";
  }
}

export class LinearIdentityLinkingConfigurationError extends Error {
  readonly code = "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "LinearIdentityLinkingConfigurationError";
  }
}

function resolveLinearOAuthAppClientIdOrThrow(input: {
  connection: {
    id: string;
    config: Record<string, unknown>;
  };
}): string {
  const connectionConfig = LinearOAuthAppConnectionConfigSchema.parse(input.connection.config);
  const clientId = connectionConfig.client_id.trim();
  if (clientId.length === 0) {
    throw new LinearIdentityLinkingConfigurationError(
      `Integration connection '${input.connection.id}' is missing Linear OAuth app client_id.`,
    );
  }

  return clientId;
}

function createLinearIdentityLinkPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function normalizeScopes(scope: LinearTokenResponse["scope"]): string[] | undefined {
  if (scope === undefined) {
    return undefined;
  }

  const scopes = (Array.isArray(scope) ? scope : scope.split(/[,\s]+/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (scopes.length === 0) {
    return undefined;
  }

  return [...new Set(scopes)];
}

function formatLinearGraphqlErrors(
  errors: readonly z.output<typeof LinearGraphqlErrorSchema>[],
): string {
  return errors.map((error) => error.message).join("; ");
}

function toLinearAuthorizationFailure(input: {
  errorLabel: string;
  error: unknown;
}): LinearIdentityLinkingAuthorizationError {
  if (input.error instanceof LinearIdentityLinkingAuthorizationError) {
    return input.error;
  }

  const detail =
    input.error instanceof Error ? input.error.message : "Linear returned an invalid response.";

  return new LinearIdentityLinkingAuthorizationError(`${input.errorLabel} failed: ${detail}`);
}

async function exchangeLinearLinkedAccountToken(input: {
  requestBody: URLSearchParams;
  tokenEndpoint?: string | undefined;
}): Promise<LinearTokenResponse> {
  const response = await fetch(input.tokenEndpoint ?? LinearTokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new LinearIdentityLinkingAuthorizationError(
      `Linear token exchange failed (${response.status}): ${responseText}`,
    );
  }

  try {
    return LinearTokenResponseSchema.parse(JSON.parse(responseText));
  } catch {
    throw new LinearIdentityLinkingAuthorizationError(
      "Linear token exchange returned invalid JSON.",
    );
  }
}

async function fetchLinearViewer(input: {
  accessToken: string;
  graphqlEndpoint?: string | undefined;
}): Promise<{
  id: string;
  name?: string | undefined;
  email?: string | undefined;
}> {
  const response = await fetch(input.graphqlEndpoint ?? LinearGraphqlEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `
query MistleLinearLinkedAccountViewer {
  viewer {
    id
    name
    email
  }
}
`,
      variables: {},
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new LinearIdentityLinkingAuthorizationError(
      `Linear viewer request failed (${response.status}): ${responseText}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(responseText);
  } catch {
    throw new LinearIdentityLinkingAuthorizationError("Linear viewer response must be valid JSON.");
  }

  const parsed = LinearViewerResponseSchema.parse(parsedJson);
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new LinearIdentityLinkingAuthorizationError(
      `Linear viewer request failed: ${formatLinearGraphqlErrors(parsed.errors)}`,
    );
  }

  const viewer = parsed.data?.viewer;
  if (viewer === undefined || viewer === null) {
    throw new LinearIdentityLinkingAuthorizationError("Linear viewer response is missing viewer.");
  }

  return {
    id: viewer.id,
    ...(viewer.name === undefined || viewer.name === null ? {} : { name: viewer.name }),
    ...(viewer.email === undefined || viewer.email === null ? {} : { email: viewer.email }),
  };
}

function toCompletedIdentityLinkingAuthorization(
  input: LinearLinkedAccountAuthorizationResult,
): CompletedIdentityLinkingAuthorization {
  return {
    providerSubjectId: input.providerSubjectId,
    profile: input.profile,
    keys: input.keys,
    credential: {
      credentialKind: LinearLinkedUserCredentialKind,
      ...(input.credential.scopes === undefined ? {} : { scopes: input.credential.scopes }),
      ...(input.credential.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: input.credential.accessTokenExpiresAt }),
      secrets: [
        {
          secretKind: "oauth2_access_token",
          plaintext: input.credential.accessToken,
        },
        {
          secretKind: "oauth2_refresh_token",
          plaintext: input.credential.refreshToken,
        },
      ],
    },
  };
}

export function startLinearLinkedAccountAuthorization(input: {
  clientId: string;
  state: string;
  redirectUrl: string;
  pkceVerifier: string;
}): {
  authorizationUrl: string;
} {
  return {
    authorizationUrl: buildLinearAuthorizationUrl({
      clientId: input.clientId,
      redirectUrl: input.redirectUrl,
      state: input.state,
      pkceChallenge: createLinearIdentityLinkPkceChallenge(input.pkceVerifier),
    }),
  };
}

export async function completeLinearLinkedAccountAuthorization(input: {
  clientId: string;
  clientSecret: string;
  query: URLSearchParams;
  redirectUrl: string;
  pkceVerifier: string;
  now: string;
  tokenEndpoint?: string | undefined;
  graphqlEndpoint?: string | undefined;
}): Promise<LinearLinkedAccountAuthorizationResult> {
  const authorizationCode = resolveLinearAuthorizationCodeOrThrow(input.query);
  const tokenResponse = await exchangeLinearLinkedAccountToken({
    tokenEndpoint: input.tokenEndpoint,
    requestBody: buildLinearAuthorizationCodeExchangeRequestBody({
      code: authorizationCode,
      redirectUrl: input.redirectUrl,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      pkceVerifier: input.pkceVerifier,
    }),
  });

  if (tokenResponse.refresh_token === undefined) {
    throw new LinearIdentityLinkingAuthorizationError(
      "Linear linked-account authorization did not return a refresh token.",
    );
  }

  const viewer = await fetchLinearViewer({
    accessToken: tokenResponse.access_token,
    graphqlEndpoint: input.graphqlEndpoint,
  });
  const scopes = normalizeScopes(tokenResponse.scope);

  return {
    providerSubjectId: viewer.id,
    profile: {
      ...(viewer.name === undefined ? {} : { displayName: viewer.name }),
      ...(viewer.email === undefined ? {} : { email: viewer.email }),
    },
    keys: [
      {
        keyType: "user_id",
        keyValue: viewer.id,
      },
    ],
    credential: {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      ...(tokenResponse.expires_in === undefined
        ? {}
        : {
            accessTokenExpiresAt: resolveLinearAccessTokenExpiresAt({
              issuedAt: new Date(input.now),
              expiresIn: tokenResponse.expires_in,
            }),
          }),
      ...(scopes === undefined ? {} : { scopes }),
    },
  };
}

export async function refreshLinearLinkedAccountCredential(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now: string;
  tokenEndpoint?: string | undefined;
}): Promise<RefreshedIdentityLinkingCredential> {
  const tokenResponse = await exchangeLinearLinkedAccountToken({
    tokenEndpoint: input.tokenEndpoint,
    requestBody: buildLinearRefreshRequestBody({
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    }),
  });

  if (tokenResponse.refresh_token === undefined) {
    throw new LinearIdentityLinkingAuthorizationError(
      "Linear linked-account refresh did not return a refresh token.",
    );
  }

  const scopes = normalizeScopes(tokenResponse.scope);

  return {
    credentialKind: LinearLinkedUserCredentialKind,
    ...(scopes === undefined ? {} : { scopes }),
    ...(tokenResponse.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveLinearAccessTokenExpiresAt({
            issuedAt: new Date(input.now),
            expiresIn: tokenResponse.expires_in,
          }),
        }),
    secrets: [
      {
        secretKind: "oauth2_access_token",
        plaintext: tokenResponse.access_token,
      },
      {
        secretKind: "oauth2_refresh_token",
        plaintext: tokenResponse.refresh_token,
      },
    ],
  };
}

export const LinearIdentityLinkingCapability: IntegrationIdentityLinkingCapability<
  LinearTargetConfig,
  Record<string, string>,
  LinearConnectionConfig
> = {
  eligibleConnectionMethodIds: [LinearConnectionMethodIds.OAUTH_APP],
  supportsConnection(input) {
    const parsedConnectionConfig = LinearOAuthAppConnectionConfigSchema.safeParse(
      input.connection.config,
    );
    if (!parsedConnectionConfig.success) {
      return false;
    }

    return input.availableConnectionSecretSlotKeys.has(
      LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
    );
  },
  async startAuthorization(input) {
    const clientId = resolveLinearOAuthAppClientIdOrThrow({
      connection: input.connection,
    });

    try {
      await input.resolveConnectionSecret({
        slotKey: LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
      });
    } catch {
      throw new LinearIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing Linear OAuth app client secret.`,
      );
    }

    const pkceVerifier = randomBytes(32).toString("base64url");
    const startedAuthorization = startLinearLinkedAccountAuthorization({
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
      throw new LinearIdentityLinkingAuthorizationError(
        "Linear linked-account callback is missing the PKCE verifier.",
      );
    }

    const clientId = resolveLinearOAuthAppClientIdOrThrow({
      connection: input.connection,
    });

    let clientSecret: string;
    try {
      clientSecret = await input.resolveConnectionSecret({
        slotKey: LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
      });
    } catch {
      throw new LinearIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing Linear OAuth app client secret.`,
      );
    }

    let completedAuthorization: LinearLinkedAccountAuthorizationResult;
    try {
      completedAuthorization = await completeLinearLinkedAccountAuthorization({
        clientId,
        clientSecret,
        query: input.query,
        redirectUrl: input.redirectUrl,
        pkceVerifier: input.pkceVerifier,
        now: input.now,
      });
    } catch (error) {
      throw toLinearAuthorizationFailure({
        errorLabel: "Linear linked-account authorization",
        error,
      });
    }

    return toCompletedIdentityLinkingAuthorization(completedAuthorization);
  },
  async refreshCredential(input) {
    const clientId = resolveLinearOAuthAppClientIdOrThrow({
      connection: input.connection,
    });

    let clientSecret: string;
    try {
      clientSecret = await input.resolveConnectionSecret({
        slotKey: LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
      });
    } catch {
      throw new LinearIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing Linear OAuth app client secret.`,
      );
    }

    const refreshToken = await input.resolveCredentialSecret({
      secretKind: "oauth2_refresh_token",
    });

    return await refreshLinearLinkedAccountCredential({
      clientId,
      clientSecret,
      refreshToken,
      now: input.now,
    });
  },
};
