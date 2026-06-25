import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

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
  exchangeShopifyToken,
  refreshShopifyAccessToken,
  resolveShopifyAuthorizationCodeOrThrow,
  resolveShopifyCompleteGrantResult,
  resolveShopifyOAuthTokenEndpoint,
} from "./oauth2-authorization-code.server.js";

type SimulatedShopifyOAuthRequest = {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  method: string | undefined;
  url: string | undefined;
};

type SimulatedShopifyOAuthServer = {
  endpoint: string;
  requests: readonly SimulatedShopifyOAuthRequest[];
  stop(): Promise<void>;
};

describe("Shopify OAuth authorization code support", () => {
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

  it("resolves the Shopify OAuth token endpoint from the shop domain", () => {
    expect(resolveShopifyOAuthTokenEndpoint("Example.myshopify.com")).toBe(
      "https://example.myshopify.com/admin/oauth/access_token",
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

  it("accepts a Shopify callback with an independently computed HMAC fixture", () => {
    expect(
      resolveShopifyAuthorizationCodeOrThrow({
        query: new URLSearchParams({
          code: "authorization-code",
          shop: "example.myshopify.com",
          state: "state_123",
          timestamp: "1782379000",
          // Computed independently with:
          // printf '%s' 'code=authorization-code&shop=example.myshopify.com&state=state_123&timestamp=1782379000' | openssl dgst -sha256 -hmac 'shopify-client-secret'
          hmac: "9cb846507c0991877b80b106360c3fb1cdc92ad1494342dd9d12953755f67fa2",
        }),
        expectedShopDomain: "example.myshopify.com",
        clientSecret: "shopify-client-secret",
      }),
    ).toBe("authorization-code");
  });

  it("exchanges authorization codes through the Shopify token endpoint shape", async () => {
    const simulatedShopify = await startSimulatedShopifyOAuthServer({
      responseBody: {
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        refresh_token_expires_in: 7776000,
        scope: "read_products,write_products",
      },
    });

    try {
      const response = await exchangeShopifyToken({
        tokenEndpoint: simulatedShopify.endpoint,
        requestBody: buildShopifyAuthorizationCodeExchangeRequestBody({
          code: "authorization-code",
          clientId: "shopify-client-id",
          clientSecret: "shopify-client-secret",
        }),
        failureContext: "authorization code exchange",
      });

      expect(simulatedShopify.requests).toEqual([
        {
          body: "client_id=shopify-client-id&client_secret=shopify-client-secret&code=authorization-code&expiring=1",
          headers: expect.objectContaining({
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          }),
          method: "POST",
          url: "/admin/oauth/access_token",
        },
      ]);
      expect(response).toEqual({
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        refresh_token_expires_in: 7776000,
        scope: "read_products,write_products",
      });
    } finally {
      await simulatedShopify.stop();
    }
  });

  it("resolves completed grant results from Shopify token responses", () => {
    const completed = resolveShopifyCompleteGrantResult({
      providerState: {
        shopDomain: "example.myshopify.com",
        adminApiVersion: "2026-04",
        clientId: "shopify-client-id",
        clientSecret: "shopify-client-secret",
      },
      response: {
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        refresh_token_expires_in: 7776000,
        scope: "read_products,write_products",
      },
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
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
      accessTokenExpiresAt: "2026-01-01T01:00:00.000Z",
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: "2026-04-01T00:00:00.000Z",
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

  it("rejects callbacks with invalid Shopify HMAC values", () => {
    expect(() =>
      resolveShopifyAuthorizationCodeOrThrow({
        query: new URLSearchParams({
          code: "authorization-code",
          shop: "example.myshopify.com",
          state: "state_123",
          timestamp: "1782379000",
          hmac: "00".repeat(32),
        }),
        expectedShopDomain: "example.myshopify.com",
        clientSecret: "shopify-client-secret",
      }),
    ).toThrow("Shopify OAuth callback HMAC verification failed.");
  });

  it("refreshes expiring Shopify offline access tokens", async () => {
    const simulatedShopify = await startSimulatedShopifyOAuthServer({
      responseBody: {
        access_token: "refreshed-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
        refresh_token_expires_in: 7776000,
        scope: "read_products,write_products",
      },
    });

    try {
      const refreshed = await refreshShopifyAccessToken({
        tokenEndpoint: simulatedShopify.endpoint,
        requestBody: buildShopifyRefreshRequestBody({
          refreshToken: "refresh-token",
          clientId: "shopify-client-id",
          clientSecret: "shopify-client-secret",
        }),
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      expect(simulatedShopify.requests).toEqual([
        {
          body: "grant_type=refresh_token&refresh_token=refresh-token&client_id=shopify-client-id&client_secret=shopify-client-secret",
          headers: expect.objectContaining({
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          }),
          method: "POST",
          url: "/admin/oauth/access_token",
        },
      ]);
      expect(refreshed).toMatchObject({
        accessToken: "refreshed-access-token",
        accessTokenExpiresAt: "2026-01-01T01:00:00.000Z",
        refreshToken: "rotated-refresh-token",
        refreshTokenExpiresAt: "2026-04-01T00:00:00.000Z",
        credentialMetadata: {
          scope: "read_products,write_products",
          scopes: ["read_products", "write_products"],
        },
      });
    } finally {
      await simulatedShopify.stop();
    }
  });
});

async function startSimulatedShopifyOAuthServer(input: {
  responseBody: Record<string, unknown>;
  statusCode?: number;
}): Promise<SimulatedShopifyOAuthServer> {
  const requests: SimulatedShopifyOAuthRequest[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readRequestBody(request);
    requests.push({
      body: new URLSearchParams(body).toString(),
      headers: request.headers,
      method: request.method,
      url: request.url,
    });

    // Mirrors the Shopify authorization-code token contract used by
    // `resolveShopifyOAuthTokenEndpoint`, `exchangeShopifyToken`, and
    // `refreshShopifyAccessToken`. Shopify documents this as:
    // POST https://{shop}.myshopify.com/admin/oauth/access_token
    // https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens#authorization-code-grant
    if (request.url !== "/admin/oauth/access_token" || request.method !== "POST") {
      response.statusCode = request.url === "/admin/oauth/access_token" ? 405 : 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error_description: "Unexpected Shopify OAuth request." }));
      return;
    }

    response.statusCode = input.statusCode ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(input.responseBody));
  });

  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected simulated Shopify OAuth server to listen on a TCP port.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port.toString()}/admin/oauth/access_token`,
    requests,
    stop: () => close(server),
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";

  for await (const chunk of request) {
    if (typeof chunk !== "string") {
      throw new Error("Expected simulated Shopify OAuth request body to be decoded as UTF-8.");
    }

    body += chunk;
  }

  return body;
}
