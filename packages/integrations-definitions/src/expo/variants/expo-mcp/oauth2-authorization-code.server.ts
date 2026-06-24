import type {
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeCompleteGrantResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
} from "@mistle/integrations-core";
import {
  resolveOAuth2NextRefreshAtFromExpiresIn,
  IntegrationConnectionMethodIds,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  ExpoConnectionConfigSchema,
  ExpoMcpIssuerUrl,
  ExpoMcpOAuthScopes,
  ExpoMcpUrl,
} from "./auth.js";

const ExpoClientName = "Mistle Expo MCP";
const ExpoDynamicClientRegistrationEndpoint = `${ExpoMcpIssuerUrl}/oauth/register`;
const ExpoAuthorizationEndpoint = `${ExpoMcpIssuerUrl}/oauth/authorize`;
const ExpoTokenEndpoint = `${ExpoMcpIssuerUrl}/oauth/token`;
const ExpoDynamicClientRegistrationCreatedStatus = 201;

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const ExpoDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
  })
  .loose();

const ExpoTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const ExpoOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const ExpoProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
  })
  .strict();

type ExpoTokenResponse = z.output<typeof ExpoTokenResponseSchema>;
type ExpoProviderState = z.output<typeof ExpoProviderStateSchema>;

type ExpoRefreshFailure = {
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

export function buildExpoDynamicClientRegistrationRequestBody(input: { redirectUrl: string }): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: "none";
} {
  return {
    client_name: ExpoClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: ExpoMcpOAuthScopes.join(" "),
    token_endpoint_auth_method: "none",
  };
}

export function parseExpoDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
} {
  const parsed = ExpoDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
  };
}

export function assertExpoDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== ExpoDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `Expo OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildExpoAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(ExpoAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", ExpoMcpOAuthScopes.join(" "));
  url.searchParams.set("resource", ExpoMcpUrl);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildExpoAuthorizationCodeExchangeRequestBody(input: {
  code: string;
  redirectUrl: string;
  clientId: string;
  pkceVerifier: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", input.code);
  params.set("redirect_uri", input.redirectUrl);
  params.set("client_id", input.clientId);
  params.set("code_verifier", input.pkceVerifier);
  params.set("resource", ExpoMcpUrl);
  return params;
}

export function buildExpoRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("resource", ExpoMcpUrl);
  return params;
}

export function resolveExpoAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Expo OAuth authorization failed with error '${error}'.`
        : `Expo OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Expo OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveExpoAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveExpoCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveExpoCompleteGrantResult(input: {
  providerState: ExpoProviderState;
  response: ExpoTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveExpoCredentialMetadata({
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
          accessTokenExpiresAt: resolveExpoAccessTokenExpiresAt({
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

export function resolveExpoRefreshResult(input: {
  response: ExpoTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveExpoCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveExpoAccessTokenExpiresAt({
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

function extractExpoRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  const parsedError = ExpoOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data.error;
}

function extractExpoRefreshFailureMessage(input: { status: number; body: string }): string {
  if (input.body.trim().length === 0) {
    return `Expo OAuth refresh failed with status ${input.status}.`;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `Expo OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  const parsedError = ExpoOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return `Expo OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  if (
    parsedError.data.error_description !== undefined &&
    parsedError.data.error_description.length > 0
  ) {
    return parsedError.data.error_description;
  }

  if (parsedError.data.error !== undefined && parsedError.data.error.length > 0) {
    return parsedError.data.error;
  }

  return `Expo OAuth refresh failed with status ${input.status}: ${input.body}`;
}

export function classifyExpoRefreshFailure(input: {
  status: number;
  body: string;
}): ExpoRefreshFailure {
  const code = (() => {
    try {
      return extractExpoRefreshFailureCode(input.body);
    } catch {
      return undefined;
    }
  })();
  const classification =
    input.status === 400 || input.status === 401 || input.status === 403
      ? IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT
      : IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY;

  return {
    classification,
    ...(code === undefined ? {} : { code }),
    message: extractExpoRefreshFailureMessage(input),
  };
}

export function createExpoRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const message = input.error instanceof Error ? input.error.message : String(input.error);

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Expo OAuth refresh request failed before a response was received: ${message}`,
  });
}

export const ExpoMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  z.output<typeof ExpoConnectionConfigSchema>
> = {
  async startAuthorization(input) {
    const pkceChallenge = input.pkce?.challenge;
    if (pkceChallenge === undefined) {
      throw new Error("Expo OAuth authorization requires a PKCE challenge.");
    }

    const registrationResponse = await fetch(ExpoDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildExpoDynamicClientRegistrationRequestBody({
          redirectUrl: input.redirectUrl,
        }),
      ),
    });
    const registrationBody = await registrationResponse.text();
    assertExpoDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationBody,
    });
    const registration = parseExpoDynamicClientRegistrationResponse(JSON.parse(registrationBody));

    return {
      authorizationUrl: buildExpoAuthorizationUrl({
        clientId: registration.clientId,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge,
      }),
      providerState: {
        clientId: registration.clientId,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    const providerState = ExpoProviderStateSchema.parse(input.providerState);
    const pkceVerifier = input.pkceVerifier;
    if (pkceVerifier === undefined) {
      throw new Error("Expo OAuth code exchange requires a PKCE verifier.");
    }

    const tokenResponse = await fetch(ExpoTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildExpoAuthorizationCodeExchangeRequestBody({
        code: resolveExpoAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        pkceVerifier,
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(`Expo OAuth token exchange failed (${tokenResponse.status}): ${tokenBody}`);
    }

    return resolveExpoCompleteGrantResult({
      providerState,
      response: ExpoTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = ExpoConnectionConfigSchema.parse(input.connection.config);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(ExpoTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildExpoRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
        }),
      });
    } catch (error) {
      throw createExpoRefreshTransportFailure({ error });
    }

    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      const failure = classifyExpoRefreshFailure({
        status: tokenResponse.status,
        body: tokenBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(failure);
    }

    return resolveExpoRefreshResult({
      response: ExpoTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  resolveNextRefresh(input) {
    const parsedResponse = ExpoTokenResponseSchema.safeParse(input.response);
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
