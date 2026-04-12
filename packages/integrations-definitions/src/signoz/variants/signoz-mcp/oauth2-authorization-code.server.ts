import {
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
  type IntegrationOAuth2AuthorizationCodeCapability,
  type IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type SignozConnectionConfig,
  SignozConnectionConfigSchema,
  SignozConnectionStartConfigSchema,
  SignozRegionSchema,
  resolveSignozIssuerUrl,
} from "./auth.js";

const SignozClientName = "Mistle SigNoz MCP";

const SignozDynamicClientRegistrationResponseSchema = z.object({
  client_id: z.string().min(1),
});

const SignozTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
});

const SignozOAuthErrorResponseSchema = z.object({
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional(),
});

const SignozProviderStateSchema = z
  .object({
    region: SignozRegionSchema,
    clientId: z.string().min(1),
  })
  .strict();

type SignozTokenResponse = z.output<typeof SignozTokenResponseSchema>;

function resolveSignozRegistrationEndpoint(region: string): string {
  return `${resolveSignozIssuerUrl(region)}/oauth/register`;
}

function resolveSignozAuthorizationEndpoint(region: string): string {
  return `${resolveSignozIssuerUrl(region)}/oauth/authorize`;
}

function resolveSignozTokenEndpoint(region: string): string {
  return `${resolveSignozIssuerUrl(region)}/oauth/token`;
}

export function buildSignozDynamicClientRegistrationRequestBody(input: {
  redirectUrl: string;
}): Record<string, unknown> {
  return {
    client_name: SignozClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function buildSignozAuthorizationUrl(input: {
  region: string;
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const authorizationUrl = new URL(resolveSignozAuthorizationEndpoint(input.region));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUrl);
  authorizationUrl.searchParams.set("state", input.state);
  authorizationUrl.searchParams.set("code_challenge", input.pkceChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return authorizationUrl.toString();
}

export function buildSignozAuthorizationCodeExchangeRequestBody(input: {
  code: string;
  redirectUrl: string;
  clientId: string;
  pkceVerifier: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUrl,
    client_id: input.clientId,
    code_verifier: input.pkceVerifier,
  });
}

export function buildSignozRefreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
}

export function parseSignozDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
} {
  const parsed = SignozDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
  };
}

export function assertSignozDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== 201) {
    throw new Error(`SigNoz dynamic client registration failed (${input.status}): ${input.body}`);
  }
}

export function resolveSignozAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const description = query.get("error_description");
    if (description !== null && description.length > 0) {
      throw new Error(`SigNoz OAuth authorization failed with error '${error}': ${description}`);
    }

    throw new Error(`SigNoz OAuth authorization failed with error '${error}'.`);
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("SigNoz OAuth callback is missing an authorization code.");
  }

  return code;
}

function resolveExpiresAt(input: { issuedAt: Date; expiresInSeconds: number }): string {
  return new Date(input.issuedAt.getTime() + input.expiresInSeconds * 1000).toISOString();
}

export function resolveSignozCompleteGrantResult(input: {
  providerState: z.output<typeof SignozProviderStateSchema>;
  response: SignozTokenResponse;
  issuedAt: Date;
}): {
  connectionConfig: Omit<SignozConnectionConfig, "connection_method">;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
} {
  return {
    connectionConfig: {
      region: input.providerState.region,
      client_id: input.providerState.clientId,
    },
    accessToken: input.response.access_token,
    accessTokenExpiresAt: resolveExpiresAt({
      issuedAt: input.issuedAt,
      expiresInSeconds: input.response.expires_in,
    }),
    refreshToken: input.response.refresh_token,
  };
}

export function resolveSignozRefreshResult(input: {
  response: SignozTokenResponse;
  issuedAt: Date;
}): {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
} {
  return {
    accessToken: input.response.access_token,
    accessTokenExpiresAt: resolveExpiresAt({
      issuedAt: input.issuedAt,
      expiresInSeconds: input.response.expires_in,
    }),
    refreshToken: input.response.refresh_token,
  };
}

export function classifySignozRefreshFailure(input: { status: number; body: string }): {
  classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  code?: string;
  message: string;
} {
  const parsedBodyResult = SignozOAuthErrorResponseSchema.safeParse(JSON.parse(input.body));
  const code = parsedBodyResult.success ? parsedBodyResult.data.error : undefined;
  const message =
    parsedBodyResult.success && parsedBodyResult.data.error_description !== undefined
      ? parsedBodyResult.data.error_description
      : `SigNoz OAuth refresh failed (${input.status}).`;

  if (input.status >= 500 || code === "server_error" || code === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      ...(code === undefined ? {} : { code }),
      message,
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
    ...(code === undefined ? {} : { code }),
    message,
  };
}

export function createSignozRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `SigNoz OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangeSignozToken(input: {
  region: string;
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<SignozTokenResponse> {
  const response = await fetch(resolveSignozTokenEndpoint(input.region), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `SigNoz OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return SignozTokenResponseSchema.parse(await response.json());
}

export const SignozMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  SignozConnectionConfig
> = {
  async startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("SigNoz OAuth authorization requires PKCE.");
    }

    const connectionConfig = SignozConnectionStartConfigSchema.parse(input.connectionConfig);
    const registrationRequestBody = buildSignozDynamicClientRegistrationRequestBody({
      redirectUrl: input.redirectUrl,
    });
    const registrationResponse = await fetch(
      resolveSignozRegistrationEndpoint(connectionConfig.region),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(registrationRequestBody),
      },
    );
    const registrationResponseBody = await registrationResponse.text();

    assertSignozDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationResponseBody,
    });

    const registration = parseSignozDynamicClientRegistrationResponse(
      JSON.parse(registrationResponseBody),
    );

    return {
      authorizationUrl: buildSignozAuthorizationUrl({
        region: connectionConfig.region,
        clientId: registration.clientId,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge: input.pkce.challenge,
      }),
      providerState: {
        region: connectionConfig.region,
        clientId: registration.clientId,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    if (input.pkceVerifier === undefined) {
      throw new Error("SigNoz OAuth callback is missing PKCE verifier.");
    }

    const providerState = SignozProviderStateSchema.parse(input.providerState);
    const code = resolveSignozAuthorizationCodeOrThrow(input.query);
    const response = await exchangeSignozToken({
      region: providerState.region,
      requestBody: buildSignozAuthorizationCodeExchangeRequestBody({
        code,
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        pkceVerifier: input.pkceVerifier,
      }),
      failureContext: "authorization code exchange",
    });

    return resolveSignozCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = SignozConnectionConfigSchema.parse(input.connection.config);

    let response: Response;

    try {
      response = await fetch(resolveSignozTokenEndpoint(parsedConnectionConfig.region), {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildSignozRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: parsedConnectionConfig.client_id,
        }),
      });
    } catch (error) {
      throw createSignozRefreshTransportFailure({ error });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const failure = classifySignozRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolveSignozRefreshResult({
      response: SignozTokenResponseSchema.parse(await response.json()),
      issuedAt: new Date(),
    });
  },
};
