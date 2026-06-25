import { createHmac, timingSafeEqual } from "node:crypto";

import type {
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
  type ShopifyOAuth2AuthorizationCodeConnectionConfig,
  ShopifyOAuth2AuthorizationCodeConnectionConfigSchema,
  ShopifyOAuth2AuthorizationCodeConnectionStartConfigSchema,
  normalizeShopifyShopDomain,
} from "./auth.js";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

export const ShopifyCustomDistributionOAuthScopes: ReadonlyArray<string> = [
  "read_products",
  "write_products",
  "read_orders",
  "write_orders",
  "read_order_edits",
  "write_order_edits",
  "read_draft_orders",
  "write_draft_orders",
  "read_customers",
  "write_customers",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "write_locations",
  "read_fulfillments",
  "write_fulfillments",
  "read_assigned_fulfillment_orders",
  "write_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
  "read_third_party_fulfillment_orders",
  "write_third_party_fulfillment_orders",
  "read_shipping",
  "write_shipping",
  "read_discounts",
  "write_discounts",
  "read_price_rules",
  "write_price_rules",
  "read_content",
  "write_content",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_files",
  "write_files",
  "read_themes",
  "write_themes",
  "read_script_tags",
  "write_script_tags",
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_metaobjects",
  "write_metaobjects",
  "read_markets",
  "write_markets",
  "read_locales",
  "write_locales",
  "read_translations",
  "write_translations",
  "read_returns",
  "write_returns",
];

const ShopifyTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: StringOrNumberSchema.optional(),
    refresh_token: z.string().min(1).optional(),
    refresh_token_expires_in: StringOrNumberSchema.optional(),
    scope: z.string().min(1).optional(),
  })
  .loose();

const ShopifyOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

const ShopifyProviderStateSchema = z
  .object({
    shopDomain: z.string().min(1),
    adminApiVersion: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

export type ShopifyTokenResponse = z.output<typeof ShopifyTokenResponseSchema>;
export type ShopifyProviderState = z.output<typeof ShopifyProviderStateSchema>;

type ShopifyRefreshFailure = {
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

export function normalizeShopifyOAuthScopes(scopes: string): string[] {
  return scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function resolveShopifyCredentialMetadata(input: {
  scope?: string;
}): Record<string, unknown> | undefined {
  if (input.scope === undefined) {
    return undefined;
  }

  return {
    scope: input.scope,
    scopes: normalizeShopifyOAuthScopes(input.scope),
  };
}

export function resolveShopifyOAuthAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresIn: string | number;
}): string {
  return new Date(
    input.issuedAt.getTime() + parsePositiveInteger(input.expiresIn) * 1_000,
  ).toISOString();
}

export function buildShopifyAuthorizationUrl(input: {
  shopDomain: string;
  clientId: string;
  redirectUrl: string;
  state: string;
}): string {
  const normalizedShopDomain = normalizeShopifyShopDomain(input.shopDomain);
  const url = new URL(`https://${normalizedShopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", ShopifyCustomDistributionOAuthScopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function buildShopifyAuthorizationCodeExchangeRequestBody(input: {
  code: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("code", input.code);
  params.set("expiring", "1");
  return params;
}

export function buildShopifyRefreshRequestBody(input: {
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

export function resolveShopifyOAuthTokenEndpoint(shopDomain: string): string {
  return `https://${normalizeShopifyShopDomain(shopDomain)}/admin/oauth/access_token`;
}

export function resolveShopifyAuthorizationCodeOrThrow(input: {
  query: URLSearchParams;
  expectedShopDomain: string;
  clientSecret: string;
}): string {
  const error = input.query.get("error");
  if (error !== null && error.length > 0) {
    const errorDescription = input.query.get("error_description");
    throw new Error(
      errorDescription === null || errorDescription.length === 0
        ? `Shopify OAuth authorization failed with error '${error}'.`
        : `Shopify OAuth authorization failed with error '${error}': ${errorDescription}`,
    );
  }

  const shop = input.query.get("shop");
  if (shop === null || shop.length === 0) {
    throw new Error("Shopify OAuth callback query must include `shop`.");
  }

  const expectedShopDomain = normalizeShopifyShopDomain(input.expectedShopDomain);
  if (normalizeShopifyShopDomain(shop) !== expectedShopDomain) {
    throw new Error("Shopify OAuth callback shop did not match the requested shop.");
  }

  assertShopifyCallbackHmac({
    query: input.query,
    clientSecret: input.clientSecret,
  });

  const code = input.query.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Shopify OAuth callback query must include `code`.");
  }

  return code;
}

export function resolveShopifyCallbackHmacMessage(query: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, value] of query.entries()) {
    if (key === "hmac" || key === "signature") {
      continue;
    }
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join("&");
}

export function computeShopifyCallbackHmac(input: {
  query: URLSearchParams;
  clientSecret: string;
}): string {
  return createHmac("sha256", input.clientSecret)
    .update(resolveShopifyCallbackHmacMessage(input.query), "utf8")
    .digest("hex");
}

export function assertShopifyCallbackHmac(input: {
  query: URLSearchParams;
  clientSecret: string;
}): void {
  const hmac = input.query.get("hmac");
  if (hmac === null || hmac.length === 0) {
    throw new Error("Shopify OAuth callback query must include `hmac`.");
  }

  const expected = computeShopifyCallbackHmac(input);
  const providedBuffer = Buffer.from(hmac, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Shopify OAuth callback HMAC verification failed.");
  }
}

export function resolveShopifyCompleteGrantResult(input: {
  providerState: ShopifyProviderState;
  response: ShopifyTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeCompleteGrantResult {
  if (input.response.refresh_token === undefined) {
    throw new Error(
      "Shopify OAuth authorization did not return a refresh token. Reconnect the integration and approve expiring offline access.",
    );
  }

  const grantedScopes =
    input.response.scope === undefined
      ? undefined
      : normalizeShopifyOAuthScopes(input.response.scope);
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveShopifyCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    externalSubjectId: input.providerState.shopDomain,
    connectionConfig: {
      connection_method: "oauth2-authorization-code",
      shop_domain: input.providerState.shopDomain,
      admin_api_version: input.providerState.adminApiVersion,
      client_id: input.providerState.clientId,
      ...(grantedScopes === undefined ? {} : { granted_scopes: grantedScopes }),
    },
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveShopifyOAuthAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    refreshToken: input.response.refresh_token,
    ...(input.response.refresh_token_expires_in === undefined
      ? {}
      : {
          refreshTokenExpiresAt: resolveShopifyOAuthAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.refresh_token_expires_in,
          }),
        }),
    clientSecret: input.providerState.clientSecret,
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

export function resolveShopifyRefreshResult(input: {
  response: ShopifyTokenResponse;
  issuedAt: Date;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  const credentialMetadata =
    input.response.scope === undefined
      ? undefined
      : resolveShopifyCredentialMetadata({
          scope: input.response.scope,
        });

  return {
    accessToken: input.response.access_token,
    refreshSchedulingResponse: input.response,
    ...(input.response.expires_in === undefined
      ? {}
      : {
          accessTokenExpiresAt: resolveShopifyOAuthAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.expires_in,
          }),
        }),
    ...(input.response.refresh_token === undefined
      ? {}
      : { refreshToken: input.response.refresh_token }),
    ...(input.response.refresh_token_expires_in === undefined
      ? {}
      : {
          refreshTokenExpiresAt: resolveShopifyOAuthAccessTokenExpiresAt({
            issuedAt: input.issuedAt,
            expiresIn: input.response.refresh_token_expires_in,
          }),
        }),
    ...(credentialMetadata === undefined ? {} : { credentialMetadata }),
  };
}

function parseShopifyOAuthErrorBody(body: string): z.output<typeof ShopifyOAuthErrorBodySchema> {
  if (body.trim().length === 0) {
    return {};
  }

  return ShopifyOAuthErrorBodySchema.parse(JSON.parse(body));
}

function tryParseShopifyOAuthErrorBody(body: string): z.output<typeof ShopifyOAuthErrorBodySchema> {
  try {
    return parseShopifyOAuthErrorBody(body);
  } catch {
    return {};
  }
}

function classifyShopifyRefreshFailure(input: {
  status: number;
  body: string;
}): ShopifyRefreshFailure {
  const parsedBody = tryParseShopifyOAuthErrorBody(input.body);
  const code = parsedBody.error;
  const messageFromBody = parsedBody.error_description;

  if (input.status === 429 || input.status >= 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Shopify access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (code === "server_error" || code === "temporarily_unavailable") {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message:
        messageFromBody ??
        `Shopify access token refresh failed with status ${String(input.status)}.`,
      ...(code === undefined ? {} : { code }),
    };
  }

  if (input.status >= 400 && input.status < 500) {
    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ??
        "Shopify access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ?? `Shopify access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

function createShopifyRefreshTransportFailure(input: {
  error: unknown;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError {
  const detail =
    input.error instanceof Error && input.error.message.length > 0
      ? `: ${input.error.message}`
      : ".";

  return new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message: `Shopify OAuth refresh request failed before a response was received${detail}`,
  });
}

export async function exchangeShopifyToken(input: {
  tokenEndpoint: string;
  requestBody: URLSearchParams;
  failureContext: string;
}): Promise<ShopifyTokenResponse> {
  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: input.requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Shopify OAuth ${input.failureContext} failed (${response.status}): ${responseText}`,
    );
  }

  return ShopifyTokenResponseSchema.parse(await response.json());
}

export async function refreshShopifyAccessToken(input: {
  tokenEndpoint: string;
  requestBody: URLSearchParams;
  issuedAt: Date;
}): Promise<IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult> {
  let response: Response;
  try {
    response = await fetch(input.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: input.requestBody,
    });
  } catch (error) {
    throw createShopifyRefreshTransportFailure({ error });
  }

  if (!response.ok) {
    const responseText = await response.text();
    const failure = classifyShopifyRefreshFailure({
      status: response.status,
      body: responseText,
    });
    throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
      message: failure.message,
      classification: failure.classification,
      ...(failure.code === undefined ? {} : { code: failure.code }),
    });
  }

  return resolveShopifyRefreshResult({
    response: ShopifyTokenResponseSchema.parse(await response.json()),
    issuedAt: input.issuedAt,
  });
}

export const ShopifyOAuth2AuthorizationCodeCapability: IntegrationOAuth2AuthorizationCodeCapability<
  Record<string, unknown>,
  Record<string, string>,
  ShopifyOAuth2AuthorizationCodeConnectionConfig
> = {
  startAuthorization(input) {
    const connectionConfig = ShopifyOAuth2AuthorizationCodeConnectionStartConfigSchema.parse(
      input.connectionConfig,
    );
    const shopDomain = normalizeShopifyShopDomain(connectionConfig.shop_domain);

    return {
      authorizationUrl: buildShopifyAuthorizationUrl({
        shopDomain,
        clientId: connectionConfig.client_id,
        redirectUrl: input.redirectUrl,
        state: input.state,
      }),
      providerState: {
        shopDomain,
        adminApiVersion: connectionConfig.admin_api_version,
        clientId: connectionConfig.client_id,
        clientSecret: connectionConfig.client_secret,
      },
    };
  },

  async completeAuthorizationCodeGrant(input) {
    const providerState = ShopifyProviderStateSchema.parse(input.providerState);
    const code = resolveShopifyAuthorizationCodeOrThrow({
      query: input.query,
      expectedShopDomain: providerState.shopDomain,
      clientSecret: providerState.clientSecret,
    });
    const response = await exchangeShopifyToken({
      tokenEndpoint: resolveShopifyOAuthTokenEndpoint(providerState.shopDomain),
      requestBody: buildShopifyAuthorizationCodeExchangeRequestBody({
        code,
        clientId: providerState.clientId,
        clientSecret: providerState.clientSecret,
      }),
      failureContext: "authorization code exchange",
    });

    return resolveShopifyCompleteGrantResult({
      providerState,
      response,
      issuedAt: new Date(),
    });
  },

  async refreshAccessToken(input) {
    const parsedConnectionConfig = ShopifyOAuth2AuthorizationCodeConnectionConfigSchema.parse(
      input.connection.config,
    );

    if (input.clientSecret === undefined) {
      throw new Error("Shopify OAuth refresh requires a client secret.");
    }

    return refreshShopifyAccessToken({
      tokenEndpoint: resolveShopifyOAuthTokenEndpoint(parsedConnectionConfig.shop_domain),
      requestBody: buildShopifyRefreshRequestBody({
        refreshToken: input.refreshToken,
        clientId: parsedConnectionConfig.client_id,
        clientSecret: input.clientSecret,
      }),
      issuedAt: new Date(),
    });
  },

  resolveNextRefresh(input) {
    const parsedResponse = ShopifyTokenResponseSchema.safeParse(input.response);
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
