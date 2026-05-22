import type {
  IntegrationConnectionAuthorizationRevocationCapability,
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeCompleteGrantResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
} from "@mistle/integrations-core";
import {
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type GcpConnectionConfig,
  GcpConnectionConfigSchema,
  GcpConnectionStartConfigSchema,
  GcpOAuthScopes,
} from "./auth.js";

const GcpAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const GcpTokenEndpoint = "https://oauth2.googleapis.com/token";
const GcpRevocationEndpoint = "https://oauth2.googleapis.com/revoke";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const GcpTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const GcpOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const GcpProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

type GcpTokenResponse = z.output<typeof GcpTokenResponseSchema>;
type GcpProviderState = z.output<typeof GcpProviderStateSchema>;

type GcpRefreshFailure = {
  classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  message: string;
  code?: string;
};

function parsePositiveInteger(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer value, received '${String(input)}'.`);
  }

  return value;
}

export function buildGcpAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(GcpAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", GcpOAuthScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildGcpAuthorizationCodeExchangeRequestBody(input: {
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

export function buildGcpRefreshRequestBody(input: {
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

export async function revokeGcpOAuthToken(input: {
  token: string;
  revocationEndpoint?: string;
}): Promise<void> {
  const url = new URL(input.revocationEndpoint ?? GcpRevocationEndpoint);
  url.searchParams.set("token", input.token);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Google OAuth token revocation failed (${response.status}): ${responseText}`);
  }
}

export function resolveGcpAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Google OAuth authorization failed with error '${error}'.`
        : `Google OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Google OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveGcpAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveGcpCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveGcpCompleteGrantResult(input: {
  providerState: GcpProviderState;
  response: GcpTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  if (input.response.refresh_token === undefined) {
    throw new Error(
      "Google OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  }

  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveGcpCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    connectionConfig: {
      client_id: input.providerState.clientId,
    },
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveGcpAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    refreshToken: input.response.refresh_token,
    clientSecret: input.providerState.clientSecret,
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

export function resolveGcpRefreshResult(input: {
  response: GcpTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveGcpCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveGcpAccessTokenExpiresAt({
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

function parseGcpOAuthErrorBody(body: string): z.output<typeof GcpOAuthErrorBodySchema> {
  if (body.trim().length === 0) {
    return {};
  }

  return GcpOAuthErrorBodySchema.parse(JSON.parse(body));
}

export function classifyGcpRefreshFailure(input: {
  status: number;
  body: string;
}): GcpRefreshFailure {
  const parsedBody = (() => {
    try {
      return parseGcpOAuthErrorBody(input.body);
    } catch {
      return {};
    }
  })();
  const code = parsedBody.error;
  const messageFromBody = parsedBody.error_description;

  if (input.status === 429 || input.status >= 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Google access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (code === "server_error" || code === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Google access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (input.status >= 400 && input.status < 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ?? "Google access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ?? `Google access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

export function createGcpRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Google OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangeGcpToken(input: {
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<GcpTokenResponse> {
  const response = await fetch(GcpTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Google OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return GcpTokenResponseSchema.parse(await response.json());
}

export const GcpMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  GcpConnectionConfig
> = {
  startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("Google OAuth authorization requires PKCE.");
    }

    const connectionConfig = GcpConnectionStartConfigSchema.parse(input.connectionConfig);

    return {
      authorizationUrl: buildGcpAuthorizationUrl({
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
      throw new Error("Google OAuth callback is missing PKCE verifier.");
    }

    const providerState = GcpProviderStateSchema.parse(input.providerState);
    const code = resolveGcpAuthorizationCodeOrThrow(input.query);
    const response = await exchangeGcpToken({
      requestBody: buildGcpAuthorizationCodeExchangeRequestBody({
        code,
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
        pkceVerifier: input.pkceVerifier,
      }),
      failureContext: "authorization code exchange",
    });

    return resolveGcpCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = GcpConnectionConfigSchema.parse(input.connection.config);

    if (input.clientSecret === undefined) {
      throw new Error("Google OAuth refresh requires a client secret.");
    }

    let response: Response;

    try {
      response = await fetch(GcpTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildGcpRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: parsedConnectionConfig.client_id,
          clientSecret: input.clientSecret,
        }),
      });
    } catch (error) {
      throw createGcpRefreshTransportFailure({ error });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const failure = classifyGcpRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolveGcpRefreshResult({
      response: GcpTokenResponseSchema.parse(await response.json()),
      issuedAt: new Date(),
    });
  },
};

export const GcpMcpAuthorizationRevocationCapability: IntegrationConnectionAuthorizationRevocationCapability<
  Record<string, unknown>,
  Record<string, string>,
  GcpConnectionConfig
> = {
  async revokeConnectionAuthorization(input) {
    const token = input.credentials.refreshToken ?? input.credentials.accessToken;
    if (token === undefined) {
      return;
    }

    await revokeGcpOAuthToken({ token });
  },
};
