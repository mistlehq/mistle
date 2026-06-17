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
  type GoogleWorkspaceConnectionConfig,
  GoogleWorkspaceConnectionConfigSchema,
  GoogleWorkspaceConnectionStartConfigSchema,
  GoogleWorkspaceOAuthScopes,
} from "./auth.js";

const GoogleWorkspaceAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const GoogleWorkspaceTokenEndpoint = "https://oauth2.googleapis.com/token";
const GoogleWorkspaceRevocationEndpoint = "https://oauth2.googleapis.com/revoke";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const GoogleWorkspaceTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const GoogleWorkspaceOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const GoogleWorkspaceProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

type GoogleWorkspaceTokenResponse = z.output<typeof GoogleWorkspaceTokenResponseSchema>;
type GoogleWorkspaceProviderState = z.output<typeof GoogleWorkspaceProviderStateSchema>;

type GoogleWorkspaceRefreshFailure = {
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

export function buildGoogleWorkspaceAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(GoogleWorkspaceAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", GoogleWorkspaceOAuthScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildGoogleWorkspaceAuthorizationCodeExchangeRequestBody(input: {
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

export function buildGoogleWorkspaceRefreshRequestBody(input: {
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

export async function revokeGoogleWorkspaceOAuthToken(input: {
  token: string;
  revocationEndpoint?: string;
}): Promise<void> {
  const url = new URL(input.revocationEndpoint ?? GoogleWorkspaceRevocationEndpoint);
  url.searchParams.set("token", input.token);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Google Workspace OAuth token revocation failed (${response.status}): ${responseText}`,
    );
  }
}

export function resolveGoogleWorkspaceAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Google Workspace OAuth authorization failed with error '${error}'.`
        : `Google Workspace OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Google Workspace OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveGoogleWorkspaceAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveGoogleWorkspaceCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveGoogleWorkspaceCompleteGrantResult(input: {
  providerState: GoogleWorkspaceProviderState;
  response: GoogleWorkspaceTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  if (input.response.refresh_token === undefined) {
    throw new Error(
      "Google Workspace OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  }

  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveGoogleWorkspaceCredentialMetadata({
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
          accessTokenExpiresAt: resolveGoogleWorkspaceAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    refreshToken: input.response.refresh_token,
    clientSecret: input.providerState.clientSecret,
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

export function resolveGoogleWorkspaceRefreshResult(input: {
  response: GoogleWorkspaceTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveGoogleWorkspaceCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveGoogleWorkspaceAccessTokenExpiresAt({
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

function parseGoogleWorkspaceOAuthErrorBody(
  body: string,
): z.output<typeof GoogleWorkspaceOAuthErrorBodySchema> {
  if (body.trim().length === 0) {
    return {};
  }

  const parsed = GoogleWorkspaceOAuthErrorBodySchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    return {};
  }

  return parsed.data;
}

export function classifyGoogleWorkspaceRefreshFailure(input: {
  status: number;
  body: string;
}): GoogleWorkspaceRefreshFailure {
  const errorBody = parseGoogleWorkspaceOAuthErrorBody(input.body);

  if (input.status >= 500 || errorBody.error === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        errorBody.error_description ??
        `Google Workspace access token refresh failed with status ${String(input.status)}.`,
      ...(errorBody.error === undefined ? {} : { code: errorBody.error }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
    message:
      errorBody.error_description ??
      `Google Workspace access token refresh failed with status ${String(input.status)}.`,
    ...(errorBody.error === undefined ? {} : { code: errorBody.error }),
  };
}

export function createGoogleWorkspaceRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Google Workspace OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangeGoogleWorkspaceToken(input: {
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<GoogleWorkspaceTokenResponse> {
  const response = await fetch(GoogleWorkspaceTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Google Workspace OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return GoogleWorkspaceTokenResponseSchema.parse(await response.json());
}

export const GoogleWorkspaceMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  GoogleWorkspaceConnectionConfig
> = {
  startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("Google Workspace OAuth authorization requires PKCE.");
    }

    const startConfig = GoogleWorkspaceConnectionStartConfigSchema.parse(input.connectionConfig);

    return {
      authorizationUrl: buildGoogleWorkspaceAuthorizationUrl({
        clientId: startConfig.client_id,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge: input.pkce.challenge,
      }),
      providerState: {
        clientId: startConfig.client_id,
        clientSecret: startConfig.client_secret,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    if (input.pkceVerifier === undefined) {
      throw new Error("Google Workspace OAuth callback is missing PKCE verifier.");
    }

    const providerState = GoogleWorkspaceProviderStateSchema.parse(input.providerState);
    const response = await exchangeGoogleWorkspaceToken({
      requestBody: buildGoogleWorkspaceAuthorizationCodeExchangeRequestBody({
        code: resolveGoogleWorkspaceAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
        pkceVerifier: input.pkceVerifier,
      }),
      failureContext: "authorization code exchange",
    });

    return resolveGoogleWorkspaceCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = GoogleWorkspaceConnectionConfigSchema.parse(input.connection.config);

    if (input.clientSecret === undefined) {
      throw new Error(
        `Google Workspace OAuth connection '${input.connection.id}' is missing its OAuth client secret.`,
      );
    }

    let response: Response;

    try {
      response = await fetch(GoogleWorkspaceTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildGoogleWorkspaceRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
          clientSecret: input.clientSecret,
        }),
      });
    } catch (error) {
      throw createGoogleWorkspaceRefreshTransportFailure({ error });
    }

    const responseText = await response.text();

    if (!response.ok) {
      const failure = classifyGoogleWorkspaceRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolveGoogleWorkspaceRefreshResult({
      response: GoogleWorkspaceTokenResponseSchema.parse(JSON.parse(responseText)),
      issuedAt: new Date(),
    });
  },
};

export const GoogleWorkspaceMcpAuthorizationRevocationCapability: IntegrationConnectionAuthorizationRevocationCapability<
  Record<string, unknown>,
  Record<string, string>,
  GoogleWorkspaceConnectionConfig
> = {
  async revokeConnectionAuthorization(input) {
    const token = input.credentials.refreshToken ?? input.credentials.accessToken;
    if (token === undefined) {
      return;
    }

    await revokeGoogleWorkspaceOAuthToken({ token });
  },
};
