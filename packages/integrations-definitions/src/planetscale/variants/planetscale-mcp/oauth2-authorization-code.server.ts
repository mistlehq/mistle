import type {
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeCompleteGrantResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
} from "@mistle/integrations-core";
import {
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import { PlanetScaleConnectionConfigSchema, type PlanetScaleConnectionConfig } from "./auth.js";

const PlanetScaleClientName = "Mistle PlanetScale MCP";
const PlanetScaleAuthorizationEndpoint = "https://app.planetscale.com/oauth/authorize";
const PlanetScaleTokenEndpoint = "https://auth.planetscale.com/oauth/token";
const PlanetScaleDynamicClientRegistrationEndpoint =
  "https://auth.planetscale.com/oauth/registration";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const PlanetScaleDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .loose();

const PlanetScaleTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).optional(),
  })
  .loose();

const PlanetScaleProviderStateSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

type PlanetScaleTokenResponse = z.output<typeof PlanetScaleTokenResponseSchema>;
type PlanetScaleProviderState = z.output<typeof PlanetScaleProviderStateSchema>;

type PlanetScaleRefreshFailure = {
  classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  message: string;
  code?: string;
};

const PlanetScaleDynamicClientRegistrationCreatedStatus = 201;

function parsePositiveInteger(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer value, received '${String(input)}'.`);
  }

  return value;
}

export function buildPlanetScaleDynamicClientRegistrationRequestBody(input: {
  redirectUrl: string;
}): {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "client_secret_post";
} {
  return {
    client_name: PlanetScaleClientName,
    redirect_uris: [input.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };
}

export function parsePlanetScaleDynamicClientRegistrationResponse(input: unknown): {
  clientId: string;
  clientSecret: string;
} {
  const parsed = PlanetScaleDynamicClientRegistrationResponseSchema.parse(input);

  return {
    clientId: parsed.client_id,
    clientSecret: parsed.client_secret,
  };
}

export function assertPlanetScaleDynamicClientRegistrationSucceeded(input: {
  status: number;
  body: string;
}): void {
  if (input.status !== PlanetScaleDynamicClientRegistrationCreatedStatus) {
    throw new Error(
      `PlanetScale OAuth dynamic client registration failed (${input.status}): ${input.body}`,
    );
  }
}

export function buildPlanetScaleAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkceChallenge: string;
}): string {
  const url = new URL(PlanetScaleAuthorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildPlanetScaleAuthorizationCodeExchangeRequestBody(input: {
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

export function buildPlanetScaleRefreshRequestBody(input: {
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

export function resolvePlanetScaleAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const error = query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `PlanetScale OAuth authorization failed with error '${error}'.`
        : `PlanetScale OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("PlanetScale OAuth callback query must include `code`.");
  }

  return code;
}

export function resolvePlanetScaleAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

function resolvePlanetScaleCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  return input.scope === undefined ? undefined : { scope: input.scope };
}

export function resolvePlanetScaleCompleteGrantResult(input: {
  providerState: PlanetScaleProviderState;
  response: PlanetScaleTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolvePlanetScaleCredentialMetadata({
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
          accessTokenExpiresAt: resolvePlanetScaleAccessTokenExpiresAt({
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

export function resolvePlanetScaleRefreshResult(input: {
  response: PlanetScaleTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolvePlanetScaleCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolvePlanetScaleAccessTokenExpiresAt({
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

function extractPlanetScaleRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return undefined;
  }

  const error = parsedBody["error"];
  return typeof error === "string" && error.length > 0 ? error : undefined;
}

function extractPlanetScaleRefreshFailureMessage(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return undefined;
  }

  const errorDescription = parsedBody["error_description"];
  return typeof errorDescription === "string" && errorDescription.length > 0
    ? errorDescription
    : undefined;
}

export function classifyPlanetScaleRefreshFailure(input: {
  status: number;
  body: string;
}): PlanetScaleRefreshFailure {
  const code = (() => {
    try {
      return extractPlanetScaleRefreshFailureCode(input.body);
    } catch {
      return undefined;
    }
  })();
  const messageFromBody = (() => {
    try {
      return extractPlanetScaleRefreshFailureMessage(input.body);
    } catch {
      return undefined;
    }
  })();

  if (
    (input.status === 400 || input.status === 401) &&
    (code === "invalid_grant" || code === "invalid_client")
  ) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ??
        "PlanetScale access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ??
      `PlanetScale access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

export function createPlanetScaleRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `PlanetScale OAuth refresh request failed before a response was received${detail}`,
  });
}

async function exchangePlanetScaleToken(input: {
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<PlanetScaleTokenResponse> {
  const response = await fetch(PlanetScaleTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `PlanetScale OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return PlanetScaleTokenResponseSchema.parse(await response.json());
}

export const PlanetScaleMcpOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  PlanetScaleConnectionConfig
> = {
  async startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("PlanetScale OAuth authorization requires PKCE.");
    }

    const registrationRequestBody = buildPlanetScaleDynamicClientRegistrationRequestBody({
      redirectUrl: input.redirectUrl,
    });
    const registrationResponse = await fetch(PlanetScaleDynamicClientRegistrationEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(registrationRequestBody),
    });
    const registrationResponseBody = await registrationResponse.text();

    assertPlanetScaleDynamicClientRegistrationSucceeded({
      status: registrationResponse.status,
      body: registrationResponseBody,
    });

    const registration = parsePlanetScaleDynamicClientRegistrationResponse(
      JSON.parse(registrationResponseBody),
    );

    return {
      authorizationUrl: buildPlanetScaleAuthorizationUrl({
        clientId: registration.clientId,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkceChallenge: input.pkce.challenge,
      }),
      providerState: {
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    if (input.pkceVerifier === undefined) {
      throw new Error("PlanetScale OAuth callback is missing PKCE verifier.");
    }

    const providerState = PlanetScaleProviderStateSchema.parse(input.providerState);
    const code = resolvePlanetScaleAuthorizationCodeOrThrow(input.query);
    const response = await exchangePlanetScaleToken({
      requestBody: buildPlanetScaleAuthorizationCodeExchangeRequestBody({
        code,
        redirectUrl: input.redirectUrl,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
        pkceVerifier: input.pkceVerifier,
      }),
      failureContext: "authorization code exchange",
    });

    return resolvePlanetScaleCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = PlanetScaleConnectionConfigSchema.parse(input.connection.config);

    if (input.clientSecret === undefined) {
      throw new Error("PlanetScale OAuth refresh requires a client secret.");
    }

    let response: Response;

    try {
      response = await fetch(PlanetScaleTokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: buildPlanetScaleRefreshRequestBody({
          refreshToken: input.refreshToken,
          clientId: parsedConnectionConfig.client_id,
          clientSecret: input.clientSecret,
        }),
      });
    } catch (error) {
      throw createPlanetScaleRefreshTransportFailure({ error });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const failure = classifyPlanetScaleRefreshFailure({
        status: response.status,
        body: responseText,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
        message: failure.message,
        classification: failure.classification,
        ...(failure.code === undefined ? {} : { code: failure.code }),
      });
    }

    return resolvePlanetScaleRefreshResult({
      response: PlanetScaleTokenResponseSchema.parse(await response.json()),
      issuedAt: new Date(),
    });
  },
};
