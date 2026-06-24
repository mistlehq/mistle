import type {
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
  DataForSeoConnectionConfigSchema,
  DataForSeoMcpOAuthScopes,
  DataForSeoMcpResource,
  DataForSeoOAuthIssuerUrl,
} from "./auth.js";

const DataForSeoClientName = "Mistle DataForSEO MCP";
const DataForSeoDynamicClientRegistrationEndpoint = `${DataForSeoOAuthIssuerUrl}/oauth/clients/register`;
const DataForSeoAuthorizationEndpoint = `${DataForSeoOAuthIssuerUrl}/oauth/authorize`;
const DataForSeoTokenEndpoint = `${DataForSeoOAuthIssuerUrl}/oauth/token`;
const DataForSeoDynamicClientRegistrationCreatedStatus = 201;

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const DataForSeoDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
  })
  .loose();

const DataForSeoTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const DataForSeoOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const DataForSeoProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
  })
  .strict();

type DataForSeoTokenResponse = z.output<typeof DataForSeoTokenResponseSchema>;
type DataForSeoProviderState = z.output<typeof DataForSeoProviderStateSchema>;

type DataForSeoRefreshFailure = {
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

export function buildDataForSeoDynamicClientRegistrationRequestBody(input: {
  redirectUrl: string;
}): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
} {
  return {
    client_name: DataForSeoClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function parseDataForSeoDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
} {
  const parsed = DataForSeoDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
  };
}

export function assertDataForSeoDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== DataForSeoDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `DataForSEO OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildDataForSeoAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(DataForSeoAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", DataForSeoMcpOAuthScopes.join(" "));
  url.searchParams.set("resource", DataForSeoMcpResource);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildDataForSeoAuthorizationCodeExchangeRequestBody(input: {
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
  params.set("resource", DataForSeoMcpResource);
  return params;
}

export function buildDataForSeoRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("resource", DataForSeoMcpResource);
  return params;
}

export function resolveDataForSeoAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `DataForSEO OAuth authorization failed with error '${error}'.`
        : `DataForSEO OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("DataForSEO OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveDataForSeoAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

export function resolveDataForSeoCompleteGrantResult(input: {
  providerState: DataForSeoProviderState;
  response: DataForSeoTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  return {
    connectionConfig: {
      client_id: input.providerState.clientId,
    },
    ...resolveDataForSeoTokenResultFields({
      response: input.response,
      issuedAt: input.issuedAt,
    }),
  };
}

export function resolveDataForSeoRefreshResult(input: {
  response: DataForSeoTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  return resolveDataForSeoTokenResultFields(input);
}

function resolveDataForSeoTokenResultFields(input: {
  response: DataForSeoTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined ? undefined : { scope: input.response.scope };
  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveDataForSeoAccessTokenExpiresAt({
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

function extractDataForSeoRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  const parsedError = DataForSeoOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data.error;
}

function extractDataForSeoRefreshFailureMessage(input: { status: number; body: string }): string {
  if (input.body.trim().length === 0) {
    return `DataForSEO OAuth refresh failed with status ${input.status}.`;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `DataForSEO OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  const parsedError = DataForSeoOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return `DataForSEO OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  if (parsedError.data.error_description !== undefined) {
    return parsedError.data.error_description;
  }

  if (parsedError.data.error !== undefined) {
    return parsedError.data.error;
  }

  return `DataForSEO OAuth refresh failed with status ${input.status}: ${input.body}`;
}

export function classifyDataForSeoRefreshFailure(input: {
  status: number;
  body: string;
}): DataForSeoRefreshFailure {
  const code = (() => {
    try {
      return extractDataForSeoRefreshFailureCode(input.body);
    } catch {
      return undefined;
    }
  })();
  const classification =
    input.status >= 500 || code === "server_error" || code === "temporarily_unavailable"
      ? IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY
      : IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT;

  return {
    classification,
    message: extractDataForSeoRefreshFailureMessage(input),
    ...(code === undefined ? {} : { code }),
  };
}

export function createDataForSeoRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `DataForSEO OAuth refresh request failed before a response was received: ${message}`,
  });
}

export const DataForSeoMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  z.output<typeof DataForSeoConnectionConfigSchema>
> = {
  async startAuthorization(input) {
    const pkceChallenge = input.pkce?.challenge;
    if (pkceChallenge === undefined) {
      throw new Error("DataForSEO OAuth authorization requires a PKCE challenge.");
    }

    const registrationResponse = await fetch(DataForSeoDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildDataForSeoDynamicClientRegistrationRequestBody({
          redirectUrl: input.redirectUrl,
        }),
      ),
    });
    const registrationBody = await registrationResponse.text();
    assertDataForSeoDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationBody,
    });
    const registration = parseDataForSeoDynamicClientRegistrationResponse(
      JSON.parse(registrationBody),
    );

    return {
      authorizationUrl: buildDataForSeoAuthorizationUrl({
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
    const providerState = DataForSeoProviderStateSchema.parse(input.providerState);
    const pkceVerifier = input.pkceVerifier;
    if (pkceVerifier === undefined) {
      throw new Error("DataForSEO OAuth code exchange requires a PKCE verifier.");
    }

    const tokenResponse = await fetch(DataForSeoTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildDataForSeoAuthorizationCodeExchangeRequestBody({
        code: resolveDataForSeoAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        pkceVerifier,
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(
        `DataForSEO OAuth token exchange failed (${tokenResponse.status}): ${tokenBody}`,
      );
    }

    return resolveDataForSeoCompleteGrantResult({
      providerState,
      response: DataForSeoTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = DataForSeoConnectionConfigSchema.parse(input.connection.config);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(DataForSeoTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildDataForSeoRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
        }),
      });
    } catch (error) {
      throw createDataForSeoRefreshTransportFailure({ error });
    }

    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      const failure = classifyDataForSeoRefreshFailure({
        status: tokenResponse.status,
        body: tokenBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(failure);
    }

    return resolveDataForSeoRefreshResult({
      response: DataForSeoTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },
};
