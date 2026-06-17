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

import { SupabaseConnectionConfigSchema, SupabaseMcpUrl, SupabaseOAuthIssuerUrl } from "./auth.js";

const SupabaseClientName = "Mistle Supabase MCP";
const SupabaseDynamicClientRegistrationEndpoint = `${SupabaseOAuthIssuerUrl}/platform/oauth/apps/register`;
const SupabaseAuthorizationEndpoint = `${SupabaseOAuthIssuerUrl}/v1/oauth/authorize`;
const SupabaseTokenEndpoint = `${SupabaseOAuthIssuerUrl}/v1/oauth/token`;
const SupabaseDynamicClientRegistrationCreatedStatus = 201;
const SupabaseOAuthScopes: ReadonlyArray<string> = [
  "organizations:read",
  "projects:read",
  "projects:write",
  "database:write",
  "database:read",
  "analytics:read",
  "secrets:read",
  "edge_functions:read",
  "edge_functions:write",
  "environment:read",
  "environment:write",
];

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const SupabaseDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .loose();

const SupabaseTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const SupabaseOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const SupabaseProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

type SupabaseTokenResponse = z.output<typeof SupabaseTokenResponseSchema>;
type SupabaseProviderState = z.output<typeof SupabaseProviderStateSchema>;

type SupabaseRefreshFailure = {
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

export function buildSupabaseDynamicClientRegistrationRequestBody(input: { redirectUrl: string }): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "client_secret_post";
} {
  return {
    client_name: SupabaseClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };
}

export function parseSupabaseDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
  clientSecret: string;
} {
  const parsed = SupabaseDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
    clientSecret: parsed.client_secret,
  };
}

export function assertSupabaseDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== SupabaseDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `Supabase OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildSupabaseAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(SupabaseAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", SupabaseOAuthScopes.join(" "));
  url.searchParams.set("resource", SupabaseMcpUrl);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildSupabaseAuthorizationCodeExchangeRequestBody(input: {
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
  params.set("resource", SupabaseMcpUrl);
  return params;
}

export function buildSupabaseRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("resource", SupabaseMcpUrl);
  return params;
}

export function resolveSupabaseAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Supabase OAuth authorization failed with error '${error}'.`
        : `Supabase OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Supabase OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveSupabaseAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveSupabaseCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveSupabaseCompleteGrantResult(input: {
  providerState: SupabaseProviderState;
  response: SupabaseTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveSupabaseCredentialMetadata({
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
          accessTokenExpiresAt: resolveSupabaseAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    ...(input.response.refresh_token === undefined
      ? {}
      : { refreshToken: input.response.refresh_token }),
    clientSecret: input.providerState.clientSecret,
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

export function resolveSupabaseRefreshResult(input: {
  response: SupabaseTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveSupabaseCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveSupabaseAccessTokenExpiresAt({
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

function extractSupabaseRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  const parsedError = SupabaseOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data.error;
}

function extractSupabaseRefreshFailureMessage(input: { status: number; body: string }): string {
  if (input.body.trim().length === 0) {
    return `Supabase OAuth refresh failed with status ${input.status}.`;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `Supabase OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  const parsedError = SupabaseOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return `Supabase OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  if (parsedError.data.error_description !== undefined) {
    return parsedError.data.error_description;
  }

  if (parsedError.data.error !== undefined) {
    return parsedError.data.error;
  }

  return `Supabase OAuth refresh failed with status ${input.status}: ${input.body}`;
}

export function classifySupabaseRefreshFailure(input: {
  status: number;
  body: string;
}): SupabaseRefreshFailure {
  const code = (() => {
    try {
      return extractSupabaseRefreshFailureCode(input.body);
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
    message: extractSupabaseRefreshFailureMessage(input),
    ...(code === undefined ? {} : { code }),
  };
}

export function createSupabaseRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Supabase OAuth refresh request failed before a response was received: ${message}`,
  });
}

export const SupabaseMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  z.output<typeof SupabaseConnectionConfigSchema>
> = {
  async startAuthorization(input) {
    const pkceChallenge = input.pkce?.challenge;
    if (pkceChallenge === undefined) {
      throw new Error("Supabase OAuth authorization requires a PKCE challenge.");
    }

    const registrationResponse = await fetch(SupabaseDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildSupabaseDynamicClientRegistrationRequestBody({
          redirectUrl: input.redirectUrl,
        }),
      ),
    });
    const registrationBody = await registrationResponse.text();
    assertSupabaseDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationBody,
    });
    const registration = parseSupabaseDynamicClientRegistrationResponse(
      JSON.parse(registrationBody),
    );

    return {
      authorizationUrl: buildSupabaseAuthorizationUrl({
        clientId: registration.clientId,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge,
      }),
      providerState: {
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    const providerState = SupabaseProviderStateSchema.parse(input.providerState);
    const pkceVerifier = input.pkceVerifier;
    if (pkceVerifier === undefined) {
      throw new Error("Supabase OAuth code exchange requires a PKCE verifier.");
    }

    const tokenResponse = await fetch(SupabaseTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildSupabaseAuthorizationCodeExchangeRequestBody({
        code: resolveSupabaseAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
        pkceVerifier,
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(
        `Supabase OAuth token exchange failed (${tokenResponse.status}): ${tokenBody}`,
      );
    }

    return resolveSupabaseCompleteGrantResult({
      providerState,
      response: SupabaseTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = SupabaseConnectionConfigSchema.parse(input.connection.config);
    if (input.clientSecret === undefined) {
      throw new Error("Supabase OAuth refresh requires a client secret.");
    }

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(SupabaseTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildSupabaseRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
          clientSecret: input.clientSecret,
        }),
      });
    } catch (error) {
      throw createSupabaseRefreshTransportFailure({ error });
    }

    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      const failure = classifySupabaseRefreshFailure({
        status: tokenResponse.status,
        body: tokenBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(failure);
    }

    return resolveSupabaseRefreshResult({
      response: SupabaseTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },
};
