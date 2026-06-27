import type {
  IntegrationConnectionAuthorizationRevocationCapability,
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeCompleteGrantResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
} from "@mistle/integrations-core";
import {
  IntegrationConnectionMethodIds,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
  resolveOAuth2NextRefreshAtFromExpiresIn,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type LinearConnectionConfig,
  LinearOAuth2ConnectionConfigSchema,
  LinearOAuth2ConnectionStartConfigSchema,
  LinearOAuthScopes,
} from "./auth.js";

const LinearAuthorizationEndpoint = "https://linear.app/oauth/authorize";
const LinearTokenEndpoint = "https://api.linear.app/oauth/token";
const LinearRevocationEndpoint = "https://api.linear.app/oauth/revoke";

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

const LinearOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const LinearProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

type LinearTokenResponse = z.output<typeof LinearTokenResponseSchema>;
type LinearProviderState = z.output<typeof LinearProviderStateSchema>;

type LinearRefreshFailure = {
  classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  message: string;
  code?: string;
};

type LinearRevocationTokenTypeHint = "access_token" | "refresh_token";

function parsePositiveInteger(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer value, received '${String(input)}'.`);
  }

  return value;
}

export function buildLinearAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(LinearAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", LinearOAuthScopes.join(","));
  url.searchParams.set("actor", "user");
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildLinearAuthorizationCodeExchangeRequestBody(input: {
  code: string;
  redirectUrl: string;
  clientId: string;
  clientSecret: string;
  pkceVerifier: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", input.code);
  params.set("redirect_uri", input.redirectUrl);
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("code_verifier", input.pkceVerifier);
  return params;
}

export function buildLinearRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  return params;
}

export function buildLinearRevocationRequestBody(input: {
  token: string;
  clientId: string;
  clientSecret: string;
  tokenTypeHint?: LinearRevocationTokenTypeHint | undefined;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("token", input.token);
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  if (input.tokenTypeHint !== undefined) {
    params.set("token_type_hint", input.tokenTypeHint);
  }
  return params;
}

export async function revokeLinearOAuthToken(input: {
  token: string;
  clientId: string;
  clientSecret: string;
  tokenTypeHint?: LinearRevocationTokenTypeHint | undefined;
  revocationEndpoint?: string;
}): Promise<void> {
  const response = await fetch(input.revocationEndpoint ?? LinearRevocationEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: buildLinearRevocationRequestBody({
      token: input.token,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      ...(input.tokenTypeHint === undefined ? {} : { tokenTypeHint: input.tokenTypeHint }),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Linear OAuth token revocation failed (${response.status}): ${responseText}`);
  }
}

export function resolveLinearAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Linear OAuth authorization failed with error '${error}'.`
        : `Linear OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Linear OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveLinearAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function normalizeLinearOAuthScope(input: LinearTokenResponse["scope"]): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  return Array.isArray(input) ? input.join(" ") : input;
}

function resolveLinearCredentialMetadata(input: {
  scope?: LinearTokenResponse["scope"];
}): Record<string, unknown> | undefined {
  const scope = normalizeLinearOAuthScope(input.scope);
  return scope === undefined ? undefined : { scope };
}

export function resolveLinearCompleteGrantResult(input: {
  providerState: LinearProviderState;
  response: LinearTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  if (input.response.refresh_token === undefined) {
    throw new Error(
      "Linear OAuth authorization did not return a refresh token. Reconnect the integration and approve access.",
    );
  }

  const credentialMetadata = resolveLinearCredentialMetadata({
    scope: input.response.scope,
  });

  return {
    connectionConfig: {
      connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: input.providerState.clientId,
    },
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveLinearAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    refreshToken: input.response.refresh_token,
    clientSecret: input.providerState.clientSecret,
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

export function resolveLinearRefreshResult(input: {
  response: LinearTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata = resolveLinearCredentialMetadata({
    scope: input.response.scope,
  });

  return {
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveLinearAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    ...(input.response.refresh_token === undefined
      ? {}
      : { refreshToken: input.response.refresh_token }),
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

function parseLinearOAuthErrorBody(body: string): z.output<typeof LinearOAuthErrorBodySchema> {
  if (body.trim().length === 0) {
    return {};
  }

  return LinearOAuthErrorBodySchema.parse(JSON.parse(body));
}

function tryParseLinearOAuthErrorBody(body: string): z.output<typeof LinearOAuthErrorBodySchema> {
  try {
    return parseLinearOAuthErrorBody(body);
  } catch {
    return {};
  }
}

export function classifyLinearRefreshFailure(input: {
  status: number;
  body: string;
}): LinearRefreshFailure {
  const parsedBody = tryParseLinearOAuthErrorBody(input.body);
  const code = parsedBody.error;
  const messageFromBody = parsedBody.error_description;

  if (input.status === 429 || input.status >= 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Linear access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (code === "server_error" || code === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Linear access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (input.status >= 400 && input.status < 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ?? "Linear access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ?? `Linear access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

export function createLinearRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Linear OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangeLinearToken(input: {
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<LinearTokenResponse> {
  const response = await fetch(LinearTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Linear OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return LinearTokenResponseSchema.parse(await response.json());
}

export const LinearOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  LinearConnectionConfig
> = {
  startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("Linear OAuth authorization requires PKCE.");
    }

    const connectionConfig = LinearOAuth2ConnectionStartConfigSchema.parse(input.connectionConfig);

    return {
      authorizationUrl: buildLinearAuthorizationUrl({
        clientId: connectionConfig.client_id,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge: input.pkce.challenge,
      }),
      providerState: {
        clientId: connectionConfig.client_id,
        clientSecret: connectionConfig.client_secret,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    if (input.pkceVerifier === undefined) {
      throw new Error("Linear OAuth callback is missing PKCE verifier.");
    }

    const providerState = LinearProviderStateSchema.parse(input.providerState);
    const code = resolveLinearAuthorizationCodeOrThrow(input.query);
    const response = await exchangeLinearToken({
      requestBody: buildLinearAuthorizationCodeExchangeRequestBody({
        code,
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
        pkceVerifier: input.pkceVerifier,
      }),
      failureContext: "authorization code exchange",
    });

    return resolveLinearCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = LinearOAuth2ConnectionConfigSchema.parse(
      input.connection.config,
    );

    if (input.clientSecret === undefined) {
      throw new Error("Linear OAuth refresh requires a client secret.");
    }

    let response: Response;

    try {
      response = await fetch(LinearTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildLinearRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: parsedConnectionConfig.client_id,
          clientSecret: input.clientSecret,
        }),
      });
    } catch (error) {
      throw createLinearRefreshTransportFailure({ error });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const failure = classifyLinearRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolveLinearRefreshResult({
      response: LinearTokenResponseSchema.parse(await response.json()),
      issuedAt: new Date(),
    });
  },

  resolveNextRefresh(input) {
    const parsedResponse = LinearTokenResponseSchema.safeParse(input.response);
    if (!parsedResponse.success) {
      input.logger?.warn(
        {
          issues: parsedResponse.error.issues,
        },
        "OAuth 2.0 next refresh resolution skipped because token response is invalid",
      );
      return undefined;
    }

    return resolveOAuth2NextRefreshAtFromExpiresIn({
      buffer: input.buffer,
      logger: input.logger,
      now: input.now,
      expiresIn: parsedResponse.data.expires_in,
    });
  },
};

export const LinearAuthorizationRevocationCapability: IntegrationConnectionAuthorizationRevocationCapability<
  Record<string, unknown>,
  Record<string, string>,
  LinearConnectionConfig
> = {
  async revokeConnectionAuthorization(input) {
    const tokensToRevoke: Array<{
      token: string;
      tokenTypeHint: LinearRevocationTokenTypeHint;
    }> = [];
    if (input.credentials.accessToken !== undefined) {
      tokensToRevoke.push({
        token: input.credentials.accessToken,
        tokenTypeHint: "access_token",
      });
    }

    if (
      input.credentials.refreshToken !== undefined &&
      input.credentials.refreshToken !== input.credentials.accessToken
    ) {
      tokensToRevoke.push({
        token: input.credentials.refreshToken,
        tokenTypeHint: "refresh_token",
      });
    }

    if (tokensToRevoke.length === 0) {
      return;
    }

    const parsedConnectionConfig = LinearOAuth2ConnectionConfigSchema.parse(
      input.connection.config,
    );
    if (input.credentials.clientSecret === undefined) {
      throw new Error("Linear OAuth token revocation requires a client secret.");
    }
    const clientSecret = input.credentials.clientSecret;

    await Promise.all(
      tokensToRevoke.map((tokenToRevoke) =>
        revokeLinearOAuthToken({
          token: tokenToRevoke.token,
          clientId: parsedConnectionConfig.client_id,
          clientSecret,
          tokenTypeHint: tokenToRevoke.tokenTypeHint,
        }),
      ),
    );
  },
};
