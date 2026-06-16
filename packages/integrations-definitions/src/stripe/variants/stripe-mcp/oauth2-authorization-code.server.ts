import type {
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeCompleteGrantResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
} from "@mistle/integrations-core";
import {
  IntegrationConnectionMethodIds,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import { StripeConnectionConfigSchema, StripeMcpIssuerUrl, StripeMcpUrl } from "./auth.js";

const StripeClientName = "Mistle Stripe MCP";
const StripeDynamicClientRegistrationEndpoint = `${StripeMcpIssuerUrl}/oauth2/register`;
const StripeAuthorizationEndpoint = `${StripeMcpIssuerUrl}/oauth2/authorize`;
const StripeTokenEndpoint = `${StripeMcpIssuerUrl}/oauth2/token`;
const StripeDynamicClientRegistrationCreatedStatus = 201;

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const StripeDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
  })
  .loose();

const StripeTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const StripeOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const StripeProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
  })
  .strict();

type StripeTokenResponse = z.output<typeof StripeTokenResponseSchema>;
type StripeProviderState = z.output<typeof StripeProviderStateSchema>;

type StripeRefreshFailure = {
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

export function buildStripeDynamicClientRegistrationRequestBody(input: { redirectUrl: string }): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
} {
  return {
    client_name: StripeClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function parseStripeDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
} {
  const parsed = StripeDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
  };
}

export function assertStripeDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== StripeDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `Stripe OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildStripeAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(StripeAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", "mcp");
  url.searchParams.set("resource", StripeMcpUrl);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildStripeAuthorizationCodeExchangeRequestBody(input: {
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
  params.set("resource", StripeMcpUrl);
  return params;
}

export function buildStripeRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("resource", StripeMcpUrl);
  return params;
}

export function resolveStripeAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Stripe OAuth authorization failed with error '${error}'.`
        : `Stripe OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Stripe OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveStripeAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveStripeCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveStripeCompleteGrantResult(input: {
  providerState: StripeProviderState;
  response: StripeTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveStripeCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    connectionConfig: {
      connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: input.providerState.clientId,
    },
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveStripeAccessTokenExpiresAt({
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

export function resolveStripeRefreshResult(input: {
  response: StripeTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveStripeCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveStripeAccessTokenExpiresAt({
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

function extractStripeRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  const parsedError = StripeOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data.error;
}

function extractStripeRefreshFailureMessage(input: { status: number; body: string }): string {
  if (input.body.trim().length === 0) {
    return `Stripe OAuth refresh failed with status ${input.status}.`;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `Stripe OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  const parsedError = StripeOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return `Stripe OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  if (parsedError.data.error_description !== undefined) {
    return parsedError.data.error_description;
  }

  if (parsedError.data.error !== undefined) {
    return parsedError.data.error;
  }

  return `Stripe OAuth refresh failed with status ${input.status}: ${input.body}`;
}

export function classifyStripeRefreshFailure(input: {
  status: number;
  body: string;
}): StripeRefreshFailure {
  const code = (() => {
    try {
      return extractStripeRefreshFailureCode(input.body);
    } catch {
      return undefined;
    }
  })();
  const classification =
    input.status === 429 ||
    input.status >= 500 ||
    code === "server_error" ||
    code === "temporarily_unavailable"
      ? IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY
      : IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT;

  return {
    classification,
    message: extractStripeRefreshFailureMessage(input),
    ...(code === undefined ? {} : { code }),
  };
}

export function createStripeRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Stripe OAuth refresh request failed before a response was received: ${message}`,
  });
}

export const StripeMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  z.output<typeof StripeConnectionConfigSchema>
> = {
  async startAuthorization(input) {
    const pkceChallenge = input.pkce?.challenge;
    if (pkceChallenge === undefined) {
      throw new Error("Stripe OAuth authorization requires a PKCE challenge.");
    }

    const registrationResponse = await fetch(StripeDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildStripeDynamicClientRegistrationRequestBody({
          redirectUrl: input.redirectUrl,
        }),
      ),
    });
    const registrationBody = await registrationResponse.text();
    assertStripeDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationBody,
    });
    const registration = parseStripeDynamicClientRegistrationResponse(JSON.parse(registrationBody));

    return {
      authorizationUrl: buildStripeAuthorizationUrl({
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
    const providerState = StripeProviderStateSchema.parse(input.providerState);
    const pkceVerifier = input.pkceVerifier;
    if (pkceVerifier === undefined) {
      throw new Error("Stripe OAuth code exchange requires a PKCE verifier.");
    }

    const tokenResponse = await fetch(StripeTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildStripeAuthorizationCodeExchangeRequestBody({
        code: resolveStripeAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        pkceVerifier,
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(`Stripe OAuth token exchange failed (${tokenResponse.status}): ${tokenBody}`);
    }

    return resolveStripeCompleteGrantResult({
      providerState,
      response: StripeTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = StripeConnectionConfigSchema.parse(input.connection.config);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(StripeTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildStripeRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
        }),
      });
    } catch (error) {
      throw createStripeRefreshTransportFailure({ error });
    }

    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      const failure = classifyStripeRefreshFailure({
        status: tokenResponse.status,
        body: tokenBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(failure);
    }

    return resolveStripeRefreshResult({
      response: StripeTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },
};
