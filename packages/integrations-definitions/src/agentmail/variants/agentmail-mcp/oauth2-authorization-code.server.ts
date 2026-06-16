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

import {
  AgentMailConnectionConfigSchema,
  AgentMailMcpIssuerUrl,
  AgentMailMcpOAuthScopes,
  AgentMailMcpResourceUrl,
} from "./auth.js";

const AgentMailClientName = "Mistle AgentMail MCP";
const AgentMailDynamicClientRegistrationEndpoint = `${AgentMailMcpIssuerUrl}/oauth/register?target=https%3A%2F%2Fclerk.console.agentmail.to%2Foauth%2Fregister`;
const AgentMailAuthorizationEndpoint = `${AgentMailMcpIssuerUrl}/oauth/authorize?target=https%3A%2F%2Fclerk.console.agentmail.to%2Foauth%2Fauthorize`;
const AgentMailTokenEndpoint = `${AgentMailMcpIssuerUrl}/oauth/token?target=https%3A%2F%2Fclerk.console.agentmail.to%2Foauth%2Ftoken`;
const AgentMailDynamicClientRegistrationCreatedStatus = 201;

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const AgentMailDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
  })
  .loose();

const AgentMailTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const AgentMailOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const AgentMailProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
  })
  .strict();

type AgentMailTokenResponse = z.output<typeof AgentMailTokenResponseSchema>;
type AgentMailProviderState = z.output<typeof AgentMailProviderStateSchema>;

type AgentMailTokenResultFields = {
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  credentialMetadata?: Record<string, unknown>;
};

type AgentMailRefreshFailure = {
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

export function buildAgentMailDynamicClientRegistrationRequestBody(input: {
  redirectUrl: string;
}): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: "none";
} {
  return {
    client_name: AgentMailClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: AgentMailMcpOAuthScopes.join(" "),
    token_endpoint_auth_method: "none",
  };
}

export function parseAgentMailDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
} {
  const parsed = AgentMailDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
  };
}

export function assertAgentMailDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== AgentMailDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `AgentMail OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildAgentMailAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(AgentMailAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", AgentMailMcpOAuthScopes.join(" "));
  url.searchParams.set("resource", AgentMailMcpResourceUrl);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildAgentMailAuthorizationCodeExchangeRequestBody(input: {
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
  params.set("resource", AgentMailMcpResourceUrl);
  return params;
}

export function buildAgentMailRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  params.set("resource", AgentMailMcpResourceUrl);
  return params;
}

export function resolveAgentMailAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `AgentMail OAuth authorization failed with error '${error}'.`
        : `AgentMail OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("AgentMail OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveAgentMailAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolveAgentMailTokenResultFields(input: {
  response: AgentMailTokenResponse;
  issuedAt: Date;
}): AgentMailTokenResultFields {
  const credentialMetadata =
    input.response.scope === undefined ? undefined : { scope: input.response.scope };

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveAgentMailAccessTokenExpiresAt({
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

export function resolveAgentMailCompleteGrantResult(input: {
  providerState: AgentMailProviderState;
  response: AgentMailTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  return {
    connectionConfig: {
      connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: input.providerState.clientId,
    },
    ...resolveAgentMailTokenResultFields(input),
  };
}

export function resolveAgentMailRefreshResult(input: {
  response: AgentMailTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  return resolveAgentMailTokenResultFields(input);
}

function extractAgentMailRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  const parsedError = AgentMailOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data.error;
}

function extractAgentMailRefreshFailureMessage(input: { status: number; body: string }): string {
  if (input.body.trim().length === 0) {
    return `AgentMail OAuth refresh failed with status ${input.status}.`;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `AgentMail OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  const parsedError = AgentMailOAuthErrorBodySchema.safeParse(parsedBody);
  if (!parsedError.success) {
    return `AgentMail OAuth refresh failed with status ${input.status}: ${input.body}`;
  }

  if (parsedError.data.error_description !== undefined) {
    return parsedError.data.error_description;
  }

  if (parsedError.data.error !== undefined) {
    return parsedError.data.error;
  }

  return `AgentMail OAuth refresh failed with status ${input.status}: ${input.body}`;
}

export function classifyAgentMailRefreshFailure(input: {
  status: number;
  body: string;
}): AgentMailRefreshFailure {
  const code = (() => {
    try {
      return extractAgentMailRefreshFailureCode(input.body);
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
    message: extractAgentMailRefreshFailureMessage(input),
    ...(code === undefined ? {} : { code }),
  };
}

export function createAgentMailRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `AgentMail OAuth refresh request failed before a response was received: ${message}`,
  });
}

export const AgentMailMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  z.output<typeof AgentMailConnectionConfigSchema>
> = {
  async startAuthorization(input) {
    const pkceChallenge = input.pkce?.challenge;
    if (pkceChallenge === undefined) {
      throw new Error("AgentMail OAuth authorization requires a PKCE challenge.");
    }

    const registrationResponse = await fetch(AgentMailDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildAgentMailDynamicClientRegistrationRequestBody({
          redirectUrl: input.redirectUrl,
        }),
      ),
    });
    const registrationBody = await registrationResponse.text();
    assertAgentMailDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationBody,
    });
    const registration = parseAgentMailDynamicClientRegistrationResponse(
      JSON.parse(registrationBody),
    );

    return {
      authorizationUrl: buildAgentMailAuthorizationUrl({
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
    const providerState = AgentMailProviderStateSchema.parse(input.providerState);
    const pkceVerifier = input.pkceVerifier;
    if (pkceVerifier === undefined) {
      throw new Error("AgentMail OAuth code exchange requires a PKCE verifier.");
    }

    const tokenResponse = await fetch(AgentMailTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildAgentMailAuthorizationCodeExchangeRequestBody({
        code: resolveAgentMailAuthorizationCodeOrThrow(input.query),
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        pkceVerifier,
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(
        `AgentMail OAuth token exchange failed (${tokenResponse.status}): ${tokenBody}`,
      );
    }

    return resolveAgentMailCompleteGrantResult({
      providerState,
      response: AgentMailTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const connectionConfig = AgentMailConnectionConfigSchema.parse(input.connection.config);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(AgentMailTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildAgentMailRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: connectionConfig.client_id,
        }),
      });
    } catch (error) {
      throw createAgentMailRefreshTransportFailure({ error });
    }

    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) {
      const failure = classifyAgentMailRefreshFailure({
        status: tokenResponse.status,
        body: tokenBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(failure);
    }

    return resolveAgentMailRefreshResult({
      response: AgentMailTokenResponseSchema.parse(JSON.parse(tokenBody)),
      issuedAt: new Date(),
    });
  },
};
