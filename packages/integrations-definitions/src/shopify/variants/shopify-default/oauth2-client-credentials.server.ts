import type {
  IntegrationOAuth2ClientCredentialsExchangeInput,
  IntegrationOAuth2ClientCredentialsExchangeResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  ShopifyConnectionConfigSchema,
  normalizeShopifyShopDomain,
  type ShopifyConnectionConfig,
} from "./auth.js";

const ShopifyClientCredentialsTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    scope: z.string().optional(),
  })
  .loose();

type ShopifyClientCredentialsTokenResponse = z.output<
  typeof ShopifyClientCredentialsTokenResponseSchema
>;

export function buildShopifyClientCredentialsRequestBody(input: {
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  return params;
}

export function parseShopifyClientCredentialsTokenResponse(
  input: unknown,
): ShopifyClientCredentialsTokenResponse {
  return ShopifyClientCredentialsTokenResponseSchema.parse(input);
}

export function resolveShopifyClientCredentialsTokenEndpoint(shopDomain: string): string {
  return `https://${normalizeShopifyShopDomain(shopDomain)}/admin/oauth/access_token`;
}

export function resolveShopifyAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresInSeconds: number;
}): string {
  return new Date(input.issuedAt.getTime() + input.expiresInSeconds * 1000).toISOString();
}

export async function exchangeShopifyClientCredentials(
  input: IntegrationOAuth2ClientCredentialsExchangeInput<
    Record<string, unknown>,
    Record<string, string>,
    ShopifyConnectionConfig
  >,
): Promise<IntegrationOAuth2ClientCredentialsExchangeResult> {
  const connectionConfig = ShopifyConnectionConfigSchema.parse(input.connection.config);
  const response = await fetch(
    resolveShopifyClientCredentialsTokenEndpoint(connectionConfig.shop_domain),
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: buildShopifyClientCredentialsRequestBody({
        clientId: connectionConfig.client_id,
        clientSecret: input.clientSecret,
      }),
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Shopify OAuth2 client-credentials exchange failed (${response.status}): ${responseText}`,
    );
  }

  const parsedResponse = parseShopifyClientCredentialsTokenResponse(await response.json());

  return {
    accessToken: parsedResponse.access_token,
    accessTokenExpiresAt: resolveShopifyAccessTokenExpiresAt({
      issuedAt: new Date(),
      expiresInSeconds: parsedResponse.expires_in,
    }),
    ...(parsedResponse.scope === undefined
      ? {}
      : {
          credentialMetadata: {
            scope: parsedResponse.scope,
          },
        }),
  };
}
