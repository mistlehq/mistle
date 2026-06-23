import { describe, expect, it } from "vitest";

import {
  normalizeShopifyShopDomain,
  resolveShopifyAdminBaseUrl,
  ShopifyConnectionConfigSchema,
  ShopifyConnectionMethodIds,
} from "./auth.js";

describe("ShopifyConnectionConfigSchema", () => {
  it("accepts custom app client credentials config", () => {
    expect(
      ShopifyConnectionConfigSchema.parse({
        connection_method: ShopifyConnectionMethodIds.CUSTOM_APP_CLIENT_CREDENTIALS,
        shop_domain: "example.myshopify.com",
        admin_api_version: "2026-04",
        client_id: "client-id",
      }),
    ).toEqual({
      connection_method: ShopifyConnectionMethodIds.CUSTOM_APP_CLIENT_CREDENTIALS,
      shop_domain: "example.myshopify.com",
      admin_api_version: "2026-04",
      client_id: "client-id",
    });
  });

  it("rejects non-myshopify shop domains", () => {
    expect(() => normalizeShopifyShopDomain("example.com")).toThrow(
      "Shopify shop domain must use a *.myshopify.com hostname.",
    );
  });
});

describe("resolveShopifyAdminBaseUrl", () => {
  it("builds the versioned Shopify Admin API base URL", () => {
    expect(
      resolveShopifyAdminBaseUrl({
        shopDomain: "Example.myshopify.com",
        adminApiVersion: "2026-04",
      }),
    ).toBe("https://example.myshopify.com/admin/api/2026-04");
  });
});
