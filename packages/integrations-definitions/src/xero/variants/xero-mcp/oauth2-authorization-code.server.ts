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
  resolveOAuth2NextRefreshAtFromExpiresIn,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type XeroConnectionConfig,
  XeroConnectionConfigSchema,
  XeroConnectionMethodIds,
  XeroConnectionStartConfigSchema,
} from "./auth.js";

const XeroAuthorizationEndpoint = "https://login.xero.com/identity/connect/authorize";
const XeroTokenEndpoint = "https://identity.xero.com/connect/token";
const XeroRevocationEndpoint = "https://identity.xero.com/connect/revocation";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const XeroTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const XeroOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const XeroProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    scopes: z.array(z.string().min(1)),
  })
  .strict();

type XeroTokenResponse = z.output<typeof XeroTokenResponseSchema>;
type XeroProviderState = z.output<typeof XeroProviderStateSchema>;

type XeroRefreshFailure = {
  classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  message: string;
  code?: string;
};

type XeroTokenResultFields = {
  accessToken: string;
  refreshSchedulingResponse: XeroTokenResponse;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  credentialMetadata?: Record<string, unknown>;
};

function parsePositiveInteger(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer value, received '${String(input)}'.`);
  }

  return value;
}

export function buildXeroAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
  scopes: ReadonlyArray<string>;
}): string {
  const url = new URL(XeroAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildXeroAuthorizationCodeExchangeRequestBody(input: {
  code: string;
  redirectUrl: string;
  pkceVerifier: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", input.code);
  params.set("redirect_uri", input.redirectUrl);
  params.set("code_verifier", input.pkceVerifier);
  return params;
}

export function buildXeroRefreshRequestBody(input: { refreshToken: string }): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  return params;
}

export function buildXeroBasicAuthorizationHeader(input: {
  clientId: string;
  clientSecret: string;
}): string {
  return `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`;
}

export function resolveXeroAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Xero OAuth authorization failed with error '${error}'.`
        : `Xero OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Xero OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveXeroAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveXeroCredentialMetadata(input: {
  scope: string | undefined;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

function resolveXeroTokenResultFields(input: {
  response: XeroTokenResponse;
  issuedAt: Date;
}): XeroTokenResultFields {
  const credentialMetadata = resolveXeroCredentialMetadata({
    scope: input.response.scope,
  });

  return {
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveXeroAccessTokenExpiresAt({
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

export function resolveXeroCompleteGrantResult(input: {
  providerState: XeroProviderState;
  response: XeroTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  if (input.response.refresh_token === undefined) {
    throw new Error(
      "Xero OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  }

  return {
    connectionConfig: {
      connection_method: XeroConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: input.providerState.clientId,
      scopes: input.providerState.scopes,
    },
    ...resolveXeroTokenResultFields({
      response: input.response,
      issuedAt: input.issuedAt,
    }),
    refreshToken: input.response.refresh_token,
    clientSecret: input.providerState.clientSecret,
  };
}

export function resolveXeroRefreshResult(input: {
  response: XeroTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  return resolveXeroTokenResultFields(input);
}

function parseXeroOAuthErrorBody(body: string): z.output<typeof XeroOAuthErrorBodySchema> {
  if (body.trim().length === 0) {
    return {};
  }

  return XeroOAuthErrorBodySchema.parse(JSON.parse(body));
}

function tryParseXeroOAuthErrorBody(body: string): z.output<typeof XeroOAuthErrorBodySchema> {
  try {
    return parseXeroOAuthErrorBody(body);
  } catch {
    return {};
  }
}

export function classifyXeroRefreshFailure(input: {
  status: number;
  body: string;
}): XeroRefreshFailure {
  const parsedBody = tryParseXeroOAuthErrorBody(input.body);
  const code = parsedBody.error;
  const messageFromBody = parsedBody.error_description;

  if (input.status === 429 || input.status >= 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ?? `Xero access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (code === "server_error" || code === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ?? `Xero access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (input.status >= 400 && input.status < 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ?? "Xero access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ?? `Xero access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

export function createXeroRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Xero OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangeXeroToken(input: {
  requestBody: URLSearchParams;
  clientId: string;
  clientSecret: string;
  failureContext: string;
}): Promise<XeroTokenResponse> {
  const response = await fetch(XeroTokenEndpoint, {
    method: "POST",
    headers: {
      authorization: buildXeroBasicAuthorizationHeader({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Xero OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return XeroTokenResponseSchema.parse(await response.json());
}

export async function revokeXeroOAuthToken(input: {
  token: string;
  clientId: string;
  clientSecret: string;
  revocationEndpoint?: string;
}): Promise<void> {
  const params = new URLSearchParams();
  params.set("token", input.token);

  const response = await fetch(input.revocationEndpoint ?? XeroRevocationEndpoint, {
    method: "POST",
    headers: {
      authorization: buildXeroBasicAuthorizationHeader({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Xero OAuth token revocation failed (${response.status}): ${responseText}`);
  }
}

export const XeroMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  XeroConnectionConfig
> = {
  startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("Xero OAuth authorization requires PKCE.");
    }

    const connectionConfig = XeroConnectionStartConfigSchema.parse(input.connectionConfig);

    return {
      authorizationUrl: buildXeroAuthorizationUrl({
        clientId: connectionConfig.client_id,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge: input.pkce.challenge,
        scopes: connectionConfig.scopes,
      }),
      providerState: {
        clientId: connectionConfig.client_id,
        clientSecret: connectionConfig.client_secret,
        scopes: connectionConfig.scopes,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    if (input.pkceVerifier === undefined) {
      throw new Error("Xero OAuth callback is missing PKCE verifier.");
    }

    const providerState = XeroProviderStateSchema.parse(input.providerState);
    const code = resolveXeroAuthorizationCodeOrThrow(input.query);
    const response = await exchangeXeroToken({
      requestBody: buildXeroAuthorizationCodeExchangeRequestBody({
        code,
        redirectUrl: input.redirectUrl,
        pkceVerifier: input.pkceVerifier,
      }),
      clientId: providerState.clientId,
      clientSecret: providerState.clientSecret,
      failureContext: "authorization code exchange",
    });

    return resolveXeroCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = XeroConnectionConfigSchema.parse(input.connection.config);

    if (input.clientSecret === undefined) {
      throw new Error("Xero OAuth refresh requires a client secret.");
    }

    let response: Response;

    try {
      response = await fetch(XeroTokenEndpoint, {
        method: "POST",
        headers: {
          authorization: buildXeroBasicAuthorizationHeader({
            clientId: parsedConnectionConfig.client_id,
            clientSecret: input.clientSecret,
          }),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildXeroRefreshRequestBody({
          refreshToken: input.refreshToken,
        }),
      });
    } catch (error) {
      throw createXeroRefreshTransportFailure({ error });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const failure = classifyXeroRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolveXeroRefreshResult({
      response: XeroTokenResponseSchema.parse(await response.json()),
      issuedAt: new Date(),
    });
  },

  resolveNextRefresh(input) {
    const parsedResponse = XeroTokenResponseSchema.safeParse(input.response);
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

export const XeroMcpAuthorizationRevocationCapability: IntegrationConnectionAuthorizationRevocationCapability<
  Record<string, unknown>,
  Record<string, string>,
  XeroConnectionConfig
> = {
  async revokeConnectionAuthorization(input) {
    const token = input.credentials.refreshToken ?? input.credentials.accessToken;
    if (token === undefined) {
      return;
    }

    const parsedConnectionConfig = XeroConnectionConfigSchema.parse(input.connection.config);
    if (input.credentials.clientSecret === undefined) {
      throw new Error("Xero OAuth revocation requires a client secret.");
    }

    await revokeXeroOAuthToken({
      token,
      clientId: parsedConnectionConfig.client_id,
      clientSecret: input.credentials.clientSecret,
    });
  },
};
