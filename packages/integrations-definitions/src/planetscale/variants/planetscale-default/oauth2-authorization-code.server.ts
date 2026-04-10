import type {
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
} from "@mistle/integrations-core";
import {
  IntegrationConnectionMethodIds,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import type { PlanetScaleConnectionConfig } from "./auth.js";
import type { PlanetScaleTargetConfig } from "./target-config-schema.js";
import type { PlanetScaleTargetSecrets } from "./target-secret-schema.js";

const PlanetScaleOauthAuthorizeEndpoint = "https://auth.planetscale.com/oauth/authorize";
const PlanetScaleOauthTokenEndpoint = "https://auth.planetscale.com/oauth/token";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const PlanetScaleTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: StringOrNumberSchema.optional(),
    refresh_token: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
  })
  .loose();

type PlanetScaleRefreshFailure = {
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

export function resolveIsoTimestampFromExpiresIn(input: {
  expiresIn: string | number;
  nowMs: number;
}): string {
  return new Date(input.nowMs + parsePositiveInteger(input.expiresIn) * 1_000).toISOString();
}

export function buildPlanetScaleAuthorizationUrl(input: {
  clientId: string;
  redirectUrl: string;
  state: string;
  pkce: {
    challenge: string;
    challengeMethod: "S256";
  };
}): string {
  const authorizationUrl = new URL(PlanetScaleOauthAuthorizeEndpoint);
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", input.state);
  authorizationUrl.searchParams.set("code_challenge", input.pkce.challenge);
  authorizationUrl.searchParams.set("code_challenge_method", input.pkce.challengeMethod);
  return authorizationUrl.toString();
}

export function buildPlanetScaleAuthorizationCodeRequestBody(input: {
  clientId: string;
  clientSecret: string;
  authorizationCode: string;
  redirectUrl: string;
  pkceVerifier?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("code", input.authorizationCode);
  params.set("redirect_uri", input.redirectUrl);
  if (input.pkceVerifier !== undefined) {
    params.set("code_verifier", input.pkceVerifier);
  }
  return params;
}

export function buildPlanetScaleRefreshRequestBody(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("refresh_token", input.refreshToken);
  return params;
}

export function parsePlanetScaleTokenResponse(input: unknown): {
  accessToken: string;
  expiresIn?: string | number;
  refreshToken?: string;
  scope?: string;
} {
  const parsed = PlanetScaleTokenResponseSchema.parse(input);
  return {
    accessToken: parsed.access_token,
    ...(parsed.expires_in === undefined ? {} : { expiresIn: parsed.expires_in }),
    ...(parsed.refresh_token === undefined ? {} : { refreshToken: parsed.refresh_token }),
    ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
  };
}

export function extractPlanetScaleOauthErrorCode(body: string): string | undefined {
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

export function extractPlanetScaleOauthErrorDescription(body: string): string | undefined {
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
      return extractPlanetScaleOauthErrorCode(input.body);
    } catch {
      return undefined;
    }
  })();
  const description = (() => {
    try {
      return extractPlanetScaleOauthErrorDescription(input.body);
    } catch {
      return undefined;
    }
  })();

  if (input.status === 400 || input.status === 401) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        description ??
        "PlanetScale access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      description ?? `PlanetScale access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

function resolvePlanetScaleConnectionConfig(): PlanetScaleConnectionConfig {
  return {
    connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
  };
}

function resolveCallbackErrorOrThrow(query: URLSearchParams): void {
  const error = query.get("error");
  if (error === null || error.length === 0) {
    return;
  }

  const errorDescription = query.get("error_description");
  throw new Error(
    errorDescription === null || errorDescription.length === 0
      ? `PlanetScale OAuth authorization failed with error '${error}'.`
      : `PlanetScale OAuth authorization failed with error '${error}': ${errorDescription}`,
  );
}

function resolveAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("PlanetScale OAuth callback query must include `code`.");
  }

  return code;
}

async function exchangePlanetScaleAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  authorizationCode: string;
  redirectUrl: string;
  pkceVerifier?: string;
}): Promise<{
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  credentialMetadata?: Record<string, unknown>;
}> {
  const response = await fetch(PlanetScaleOauthTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: buildPlanetScaleAuthorizationCodeRequestBody(input),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `PlanetScale OAuth token exchange failed (${response.status}): ${responseText}`,
    );
  }

  const parsedResponse = parsePlanetScaleTokenResponse(await response.json());
  return {
    accessToken: parsedResponse.accessToken,
    ...(parsedResponse.expiresIn === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveIsoTimestampFromExpiresIn({
            expiresIn: parsedResponse.expiresIn,
            nowMs: Date.now(),
          }),
        }),
    ...(parsedResponse.refreshToken === undefined
      ? {}
      : { refreshToken: parsedResponse.refreshToken }),
    ...(parsedResponse.scope === undefined
      ? {}
      : {
          credentialMetadata: {
            scope: parsedResponse.scope,
          },
        }),
  };
}

export const PlanetScaleOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  PlanetScaleTargetConfig,
  PlanetScaleTargetSecrets,
  PlanetScaleConnectionConfig
> = {
  async startAuthorization(input) {
    if (input.pkce === undefined) {
      throw new Error("PlanetScale OAuth authorization requires PKCE.");
    }

    return {
      authorizationUrl: buildPlanetScaleAuthorizationUrl({
        clientId: input.target.config.client_id,
        redirectUrl: input.redirectUrl,
        state: input.state,
        pkce: input.pkce,
      }),
    };
  },

  async completeAuthorizationCodeGrant(input) {
    resolveCallbackErrorOrThrow(input.query);
    const exchangedTokens = await exchangePlanetScaleAuthorizationCode({
      clientId: input.target.config.client_id,
      clientSecret: input.target.secrets.client_secret,
      authorizationCode: resolveAuthorizationCodeOrThrow(input.query),
      redirectUrl: input.redirectUrl,
      ...(input.pkceVerifier === undefined ? {} : { pkceVerifier: input.pkceVerifier }),
    });

    return {
      connectionConfig: resolvePlanetScaleConnectionConfig(),
      accessToken: exchangedTokens.accessToken,
      ...(exchangedTokens.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: exchangedTokens.accessTokenExpiresAt }),
      ...(exchangedTokens.refreshToken === undefined
        ? {}
        : { refreshToken: exchangedTokens.refreshToken }),
      ...(exchangedTokens.credentialMetadata === undefined
        ? {}
        : { credentialMetadata: exchangedTokens.credentialMetadata }),
    };
  },

  async refreshAccessToken(input) {
    const response = await fetch(PlanetScaleOauthTokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildPlanetScaleRefreshRequestBody({
        clientId: input.target.config.client_id,
        clientSecret: input.target.secrets.client_secret,
        refreshToken: input.refreshToken,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      const classifiedError = classifyPlanetScaleRefreshFailure({
        status: response.status,
        body: responseBody,
      });
      throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError(classifiedError);
    }

    const parsedResponse = parsePlanetScaleTokenResponse(await response.json());
    return {
      accessToken: parsedResponse.accessToken,
      ...(parsedResponse.expiresIn === undefined
        ? {}
        : {
            accessTokenExpiresAt: resolveIsoTimestampFromExpiresIn({
              expiresIn: parsedResponse.expiresIn,
              nowMs: Date.now(),
            }),
          }),
      ...(parsedResponse.refreshToken === undefined
        ? {}
        : { refreshToken: parsedResponse.refreshToken }),
      ...(parsedResponse.scope === undefined
        ? {}
        : {
            credentialMetadata: {
              scope: parsedResponse.scope,
            },
          }),
    };
  },
};
