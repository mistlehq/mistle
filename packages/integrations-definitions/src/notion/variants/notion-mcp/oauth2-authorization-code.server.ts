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

import { NotionConnectionConfigSchema, NotionMcpIssuerUrl, NotionMcpUrl } from "./auth.js";

const NotionClientName = "Mistle Notion MCP";
const NotionDynamicClientRegistrationEndpoint = `${NotionMcpIssuerUrl}/register`;
const NotionAuthorizationEndpoint = `${NotionMcpIssuerUrl}/authorize`;
const NotionTokenEndpoint = `${NotionMcpIssuerUrl}/token`;
const NotionDynamicClientRegistrationCreatedStatus = 201;

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const NotionDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
  })
  .loose();

const NotionTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const NotionOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const NotionProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
  })
  .strict();

type NotionTokenResponse = z.output<typeof NotionTokenResponseSchema>;
type NotionProviderState = z.output<typeof NotionProviderStateSchema>;

type NotionRefreshFailure = {
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

export function buildNotionDynamicClientRegistrationRequestBody(input: { redirectUrl: string }): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
} {
  return {
    client_name: NotionClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function parseNotionDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
} {
  const parsed = NotionDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
  };
}

export function assertNotionDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== NotionDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `Notion OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildNotionAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(NotionAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("resource", NotionMcpUrl);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildNotionAuthorizationCodeExchangeRequestBody(input: {
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
  params.set("resource", NotionMcpUrl);
  return params;
}

export function buildNotionRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("resource", NotionMcpUrl);
  return params;
}

export function resolveNotionAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Notion OAuth authorization failed with error '${error}'.`
        : `Notion OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Notion OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveNotionAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveNotionCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolveNotionCompleteGrantResult(input: {
  providerState: NotionProviderState;
  response: NotionTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveNotionCredentialMetadata({
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
          accessTokenExpiresAt: resolveNotionAccessTokenExpiresAt({
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

export function resolveNotionRefreshResult(input: {
  response: NotionTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveNotionCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveNotionAccessTokenExpiresAt({
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

function extractNotionRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  const parsedError = NotionOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data.error;
}

function extractNotionRefreshFailureMessage(input: { status: number; body: string }): string {
  if (input.body.trim().length === 0) {
    return `Notion OAuth refresh failed with status ${input.status}.`;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `Notion OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  const parsedError = NotionOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return `Notion OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  if (parsedError.data.error_description !== undefined) {
    return parsedError.data.error_description;
  }

  if (parsedError.data.error !== undefined) {
    return parsedError.data.error;
  }

  return `Notion OAuth refresh failed with status ${input.status}: ${input.body}`;
}

export function classifyNotionRefreshFailure(input: {
  status: number;
  body: string;
}): NotionRefreshFailure {
  const code = (() => {
    try {
      return extractNotionRefreshFailureCode(input.body);
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
    message: extractNotionRefreshFailureMessage(input),
    ...(code === undefined ? {} : { code }),
  };
}

export function createNotionRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Notion OAuth refresh request failed before a response was received: ${message}`,
  });
}

export const NotionMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  z.output<typeof NotionConnectionConfigSchema>
> = {
  async startAuthorization(input) {
    const pkceChallenge = input.pkce?.challenge;
    if (pkceChallenge === undefined) {
      throw new Error("Notion OAuth authorization requires a PKCE challenge.");
    }

    const registrationResponse = await fetch(NotionDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildNotionDynamicClientRegistrationRequestBody({
          redirectUrl: input.redirectUrl,
        }),
      ),
    });
    const registrationBody = await registrationResponse.text();
    assertNotionDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationBody,
    });
    const registration = parseNotionDynamicClientRegistrationResponse(JSON.parse(registrationBody));

    return {
      authorizationUrl: buildNotionAuthorizationUrl({
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
    const providerState = NotionProviderStateSchema.parse(input.providerState);
    const pkceVerifier = input.pkceVerifier;
    if (pkceVerifier === undefined) {
      throw new Error("Notion OAuth code exchange requires a PKCE verifier.");
    }

    const tokenResponse = await fetch(NotionTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildNotionAuthorizationCodeExchangeRequestBody({
        code: resolveNotionAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        pkceVerifier,
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(`Notion OAuth token exchange failed (${tokenResponse.status}): ${tokenBody}`);
    }

    return resolveNotionCompleteGrantResult({
      providerState,
      response: NotionTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = NotionConnectionConfigSchema.parse(input.connection.config);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(NotionTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildNotionRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
        }),
      });
    } catch (error) {
      throw createNotionRefreshTransportFailure({ error });
    }

    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      const failure = classifyNotionRefreshFailure({
        status: tokenResponse.status,
        body: tokenBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(failure);
    }

    return resolveNotionRefreshResult({
      response: NotionTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },
};
