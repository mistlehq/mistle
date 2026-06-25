import { afterEach, describe, expect, it } from "vitest";

import {
  ShopifyConnectionMethodIds,
  ShopifyOAuth2AuthorizationCodeConnectionConfigSchema,
} from "./auth.js";
import {
  ShopifyCustomDistributionOAuthScopes,
  ShopifyOAuth2AuthorizationCodeCapability,
  buildShopifyAuthorizationCodeExchangeRequestBody,
  buildShopifyAuthorizationUrl,
  buildShopifyRefreshRequestBody,
  computeShopifyCallbackHmac,
} from "./oauth2-authorization-code.server.js";

const OriginalFetch = globalThis.fetch;
type FetchCall = Parameters<typeof fetch>;

function installFetchResponse(response: Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    calls.push(args);
    return Promise.resolve(response);
  }) as typeof fetch;

  return calls;
}

function createCallbackQuery(input: {
  code: string;
  shop: string;
  state: string;
  timestamp: string;
  clientSecret: string;
}): URLSearchParams {
  const query = new URLSearchParams({
    code: input.code,
    shop: input.shop,
    state: input.state,
    timestamp: input.timestamp,
  });
  query.set(
    "hmac",
    computeShopifyCallbackHmac({
      query,
      clientSecret: input.clientSecret,
    }),
  );
  return query;
}

describe("Shopify OAuth authorization code support", () => {
  afterEach(() => {
    globalThis.fetch = OriginalFetch;
  });

  it("builds a Shopify authorization URL with the static custom distribution scopes", () => {
    const authorizationUrl = new URL(
      buildShopifyAuthorizationUrl({
        shopDomain: "Example.myshopify.com",
        clientId: "shopify-client-id",
        redirectUrl: "https://api.mistle.dev/p/integration/callbacks/shopify/oauth2",
        state: "state_123",
      }),
    );

    expect(authorizationUrl.origin).toBe("https://example.myshopify.com");
    expect(authorizationUrl.pathname).toBe("/admin/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("shopify-client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://api.mistle.dev/p/integration/callbacks/shopify/oauth2",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      ShopifyCustomDistributionOAuthScopes.join(","),
    );
  });

  it("builds Shopify token exchange and refresh request bodies", () => {
    expect(
      buildShopifyAuthorizationCodeExchangeRequestBody({
        code: "authorization-code",
        clientId: "shopify-client-id",
        clientSecret: "shopify-client-secret",
      }).toString(),
    ).toBe(
      "client_id=shopify-client-id&client_secret=shopify-client-secret&code=authorization-code&expiring=1",
    );

    expect(
      buildShopifyRefreshRequestBody({
        refreshToken: "refresh-token",
        clientId: "shopify-client-id",
        clientSecret: "shopify-client-secret",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh-token&client_id=shopify-client-id&client_secret=shopify-client-secret",
    );
  });

  it("starts authorization with user-provided custom distribution app credentials", async () => {
    const started = await ShopifyOAuth2AuthorizationCodeCapability.startAuthorization({
      organizationId: "org_123",
      targetKey: "shopify-default",
      target: {
        familyId: "shopify",
        variantId: "shopify-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connectionConfig: {
        shop_domain: "Example.myshopify.com",
        admin_api_version: "2026-04",
        client_id: "shopify-client-id",
        client_secret: "shopify-client-secret",
      },
      intent: "create",
      state: "state_123",
      redirectUrl: "https://api.mistle.dev/p/integration/callbacks/shopify/oauth2",
    });

    expect(new URL(started.authorizationUrl).searchParams.get("scope")).toBe(
      ShopifyCustomDistributionOAuthScopes.join(","),
    );
    expect(started.providerState).toEqual({
      shopDomain: "example.myshopify.com",
      adminApiVersion: "2026-04",
      clientId: "shopify-client-id",
      clientSecret: "shopify-client-secret",
    });
  });

  it("completes authorization after validating the Shopify callback HMAC", async () => {
    const fetchCalls = installFetchResponse(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          refresh_token_expires_in: 7776000,
          scope: "read_products,write_products",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const completed = await ShopifyOAuth2AuthorizationCodeCapability.completeAuthorizationCodeGrant(
      {
        organizationId: "org_123",
        targetKey: "shopify-default",
        target: {
          familyId: "shopify",
          variantId: "shopify-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        query: createCallbackQuery({
          code: "authorization-code",
          shop: "example.myshopify.com",
          state: "state_123",
          timestamp: "1782379000",
          clientSecret: "shopify-client-secret",
        }),
        redirectUrl: "https://api.mistle.dev/p/integration/callbacks/shopify/oauth2",
        providerState: {
          shopDomain: "example.myshopify.com",
          adminApiVersion: "2026-04",
          clientId: "shopify-client-id",
          clientSecret: "shopify-client-secret",
        },
      },
    );

    expect(fetchCalls).toEqual([
      [
        "https://example.myshopify.com/admin/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          body: expect.any(URLSearchParams),
        }),
      ],
    ]);
    expect(completed).toMatchObject({
      externalSubjectId: "example.myshopify.com",
      connectionConfig: {
        connection_method: ShopifyConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        shop_domain: "example.myshopify.com",
        admin_api_version: "2026-04",
        client_id: "shopify-client-id",
        granted_scopes: ["read_products", "write_products"],
      },
      accessToken: "access-token",
      refreshToken: "refresh-token",
      clientSecret: "shopify-client-secret",
      credentialMetadata: {
        scope: "read_products,write_products",
        scopes: ["read_products", "write_products"],
      },
    });
    expect(
      ShopifyOAuth2AuthorizationCodeConnectionConfigSchema.parse(completed.connectionConfig),
    ).toEqual(completed.connectionConfig);
  });

  it("rejects callbacks with invalid Shopify HMAC values", async () => {
    await expect(
      ShopifyOAuth2AuthorizationCodeCapability.completeAuthorizationCodeGrant({
        organizationId: "org_123",
        targetKey: "shopify-default",
        target: {
          familyId: "shopify",
          variantId: "shopify-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        query: new URLSearchParams({
          code: "authorization-code",
          shop: "example.myshopify.com",
          state: "state_123",
          timestamp: "1782379000",
          hmac: "00".repeat(32),
        }),
        redirectUrl: "https://api.mistle.dev/p/integration/callbacks/shopify/oauth2",
        providerState: {
          shopDomain: "example.myshopify.com",
          adminApiVersion: "2026-04",
          clientId: "shopify-client-id",
          clientSecret: "shopify-client-secret",
        },
      }),
    ).rejects.toThrow("Shopify OAuth callback HMAC verification failed.");
  });

  it("refreshes expiring Shopify offline access tokens", async () => {
    const fetchCalls = installFetchResponse(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access-token",
          expires_in: 3600,
          refresh_token: "rotated-refresh-token",
          refresh_token_expires_in: 7776000,
          scope: "read_products,write_products",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const refreshed = await ShopifyOAuth2AuthorizationCodeCapability.refreshAccessToken({
      organizationId: "org_123",
      targetKey: "shopify-default",
      target: {
        familyId: "shopify",
        variantId: "shopify-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_shopify",
        status: "active",
        config: {
          connection_method: ShopifyConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
          shop_domain: "example.myshopify.com",
          admin_api_version: "2026-04",
          client_id: "shopify-client-id",
        },
      },
      refreshToken: "refresh-token",
      clientSecret: "shopify-client-secret",
    });

    expect(fetchCalls).toEqual([
      [
        "https://example.myshopify.com/admin/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          body: expect.any(URLSearchParams),
        }),
      ],
    ]);
    expect(refreshed).toMatchObject({
      accessToken: "refreshed-access-token",
      refreshToken: "rotated-refresh-token",
      credentialMetadata: {
        scope: "read_products,write_products",
        scopes: ["read_products", "write_products"],
      },
    });
  });
});
