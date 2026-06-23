import { describe, expect, it } from "vitest";

import {
  buildShopifyClientCredentialsRequestBody,
  parseShopifyClientCredentialsTokenResponse,
  resolveShopifyAccessTokenExpiresAt,
  resolveShopifyClientCredentialsTokenEndpoint,
} from "./oauth2-client-credentials.server.js";

describe("buildShopifyClientCredentialsRequestBody", () => {
  it("builds the expected Shopify client credentials token exchange request body", () => {
    const requestBody = buildShopifyClientCredentialsRequestBody({
      clientId: "client-id-123",
      clientSecret: "client-secret-456",
    });

    expect(requestBody.toString()).toBe(
      "grant_type=client_credentials&client_id=client-id-123&client_secret=client-secret-456",
    );
  });
});

describe("parseShopifyClientCredentialsTokenResponse", () => {
  it("parses the Shopify client credentials token response", () => {
    expect(
      parseShopifyClientCredentialsTokenResponse({
        access_token: "access-token-123",
        expires_in: 86_400,
        scope: "read_products,write_products",
      }),
    ).toEqual({
      access_token: "access-token-123",
      expires_in: 86_400,
      scope: "read_products,write_products",
    });
  });
});

describe("resolveShopifyAccessTokenExpiresAt", () => {
  it("calculates the token expiry timestamp", () => {
    expect(
      resolveShopifyAccessTokenExpiresAt({
        issuedAt: new Date("2026-06-23T00:00:00.000Z"),
        expiresInSeconds: 86_400,
      }),
    ).toBe("2026-06-24T00:00:00.000Z");
  });
});

describe("resolveShopifyClientCredentialsTokenEndpoint", () => {
  it("builds the Shopify token endpoint from the shop domain", () => {
    expect(resolveShopifyClientCredentialsTokenEndpoint("example.myshopify.com")).toBe(
      "https://example.myshopify.com/admin/oauth/access_token",
    );
  });
});
