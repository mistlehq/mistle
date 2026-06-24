import type {
  IntegrationConnectionAuthorizationRevocationCapability,
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeCompleteGrantResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
} from "@mistle/integrations-core";
import {
  resolveOAuth2NextRefreshAtFromExpiresIn,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type GoogleSearchConsoleConnectionConfig,
  GoogleSearchConsoleConnectionConfigSchema,
  GoogleSearchConsoleConnectionStartConfigSchema,
  GoogleSearchConsoleOAuthScopes,
} from "./auth.js";

const GoogleSearchConsoleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const GoogleSearchConsoleTokenEndpoint = "https://oauth2.googleapis.com/token";
const GoogleSearchConsoleRevocationEndpoint = "https://oauth2.googleapis.com/revoke";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const GoogleSearchConsoleTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const GoogleSearchConsoleOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const GoogleSearchConsoleProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

type GoogleSearchConsoleTokenResponse = z.output<typeof GoogleSearchConsoleTokenResponseSchema>;
type GoogleSearchConsoleProviderState = z.output<typeof GoogleSearchConsoleProviderStateSchema>;

type GoogleSearchConsoleRefreshFailure = {
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

export function buildGoogleSearchConsoleAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(GoogleSearchConsoleAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", GoogleSearchConsoleOAuthScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildGoogleSearchConsoleAuthorizationCodeExchangeRequestBody(input: {
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

export function buildGoogleSearchConsoleRefreshRequestBody(input: {
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

export async function revokeGoogleSearchConsoleOAuthToken(input: {
  token: string;
  revocationEndpoint?: string;
}): Promise<void> {
  const url = new URL(input.revocationEndpoint ?? GoogleSearchConsoleRevocationEndpoint);
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
      `Google Search Console OAuth token revocation failed (${response.status}): ${responseText}`,
    );
  }
}

export function resolveGoogleSearchConsoleAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Google Search Console OAuth authorization failed with error '${error}'.`
        : `Google Search Console OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Google Search Console OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveGoogleSearchConsoleAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveGoogleSearchConsoleCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveGoogleSearchConsoleCompleteGrantResult(input: {
  providerState: GoogleSearchConsoleProviderState;
  response: GoogleSearchConsoleTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  if (input.response.refresh_token === undefined) {
    throw new Error(
      "Google Search Console OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  }

  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveGoogleSearchConsoleCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    connectionConfig: {
      client_id: input.providerState.clientId,
    },
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveGoogleSearchConsoleAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    refreshToken: input.response.refresh_token,
    clientSecret: input.providerState.clientSecret,
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

export function resolveGoogleSearchConsoleRefreshResult(input: {
  response: GoogleSearchConsoleTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveGoogleSearchConsoleCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveGoogleSearchConsoleAccessTokenExpiresAt({
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

function parseGoogleSearchConsoleOAuthErrorBody(
  body: string,
): z.output<typeof GoogleSearchConsoleOAuthErrorBodySchema> {
  if (body.trim().length === 0) {
    return {};
  }

  return GoogleSearchConsoleOAuthErrorBodySchema.parse(JSON.parse(body));
}

function tryParseGoogleSearchConsoleOAuthErrorBody(
  body: string,
): z.output<typeof GoogleSearchConsoleOAuthErrorBodySchema> {
  try {
    return parseGoogleSearchConsoleOAuthErrorBody(body);
  } catch {
    return {};
  }
}

export function classifyGoogleSearchConsoleRefreshFailure(input: {
  status: number;
  body: string;
}): GoogleSearchConsoleRefreshFailure {
  const parsedBody = tryParseGoogleSearchConsoleOAuthErrorBody(input.body);
  const code = parsedBody.error;
  const messageFromBody = parsedBody.error_description;

  if (input.status === 429 || input.status >= 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Google Search Console access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (code === "server_error" || code === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Google Search Console access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (input.status >= 400 && input.status < 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ??
        "Google Search Console access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ??
      `Google Search Console access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

export function createGoogleSearchConsoleRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Google Search Console OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangeGoogleSearchConsoleToken(input: {
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<GoogleSearchConsoleTokenResponse> {
  const response = await fetch(GoogleSearchConsoleTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Google Search Console OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return GoogleSearchConsoleTokenResponseSchema.parse(await response.json());
}

export const GoogleSearchConsoleMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  GoogleSearchConsoleConnectionConfig
> = {
  startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("Google Search Console OAuth authorization requires PKCE.");
    }

    const connectionConfig = GoogleSearchConsoleConnectionStartConfigSchema.parse(
      input.connectionConfig,
    );

    return {
      authorizationUrl: buildGoogleSearchConsoleAuthorizationUrl({
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
      throw new Error("Google Search Console OAuth callback is missing PKCE verifier.");
    }

    const providerState = GoogleSearchConsoleProviderStateSchema.parse(input.providerState);
    const code = resolveGoogleSearchConsoleAuthorizationCodeOrThrow(input.query);
    const response = await exchangeGoogleSearchConsoleToken({
      requestBody: buildGoogleSearchConsoleAuthorizationCodeExchangeRequestBody({
        code,
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
        pkceVerifier: input.pkceVerifier,
      }),
      failureContext: "authorization code exchange",
    });

    return resolveGoogleSearchConsoleCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = GoogleSearchConsoleConnectionConfigSchema.parse(
      input.connection.config,
    );

    if (input.clientSecret === undefined) {
      throw new Error("Google Search Console OAuth refresh requires a client secret.");
    }

    let response: Response;

    try {
      response = await fetch(GoogleSearchConsoleTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildGoogleSearchConsoleRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: parsedConnectionConfig.client_id,
          clientSecret: input.clientSecret,
        }),
      });
    } catch (error) {
      throw createGoogleSearchConsoleRefreshTransportFailure({ error });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const failure = classifyGoogleSearchConsoleRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolveGoogleSearchConsoleRefreshResult({
      response: GoogleSearchConsoleTokenResponseSchema.parse(await response.json()),
      issuedAt: new Date(),
    });
  },

  resolveNextRefresh(input) {
    const parsedResponse = GoogleSearchConsoleTokenResponseSchema.safeParse(input.response);
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

export const GoogleSearchConsoleMcpAuthorizationRevocationCapability: IntegrationConnectionAuthorizationRevocationCapability<
  Record<string, unknown>,
  Record<string, string>,
  GoogleSearchConsoleConnectionConfig
> = {
  async revokeConnectionAuthorization(input) {
    const token = input.credentials.refreshToken ?? input.credentials.accessToken;
    if (token === undefined) {
      return;
    }

    await revokeGoogleSearchConsoleOAuthToken({ token });
  },
};
