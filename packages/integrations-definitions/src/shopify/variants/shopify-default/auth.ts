import { z } from "zod";

export const ShopifyFamilyId = "shopify";
export const ShopifyDefaultVariantId = "shopify-default";

export const ShopifyConnectionMethodIds = {
  CUSTOM_APP_CLIENT_CREDENTIALS: "shopify-custom-app-client-credentials",
} as const;

export const ShopifyCredentialSecretTypes = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret",
} as const;

export const ShopifyCredentialSlotKeys = {
  CUSTOM_APP_CLIENT_CREDENTIALS_CLIENT_SECRET:
    "shopify.shopify-default.shopify-custom-app-client-credentials.client-secret",
  CUSTOM_APP_CLIENT_CREDENTIALS_ACCESS_TOKEN:
    "shopify.shopify-default.shopify-custom-app-client-credentials.access-token",
} as const;

function tryParseShopifyShopDomain(value: string): URL | null {
  try {
    return new URL(`https://${value}`);
  } catch {
    return null;
  }
}

export const ShopifyShopDomainSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    const parsedUrl = tryParseShopifyShopDomain(value);
    if (parsedUrl === null) {
      ctx.addIssue({
        code: "custom",
        message: "Shopify shop domain must be a valid hostname.",
      });
      return;
    }

    if (parsedUrl.hostname !== value.toLowerCase()) {
      ctx.addIssue({
        code: "custom",
        message: "Shopify shop domain must not include a scheme, path, query, or hash.",
      });
      return;
    }

    if (!parsedUrl.hostname.endsWith(".myshopify.com")) {
      ctx.addIssue({
        code: "custom",
        message: "Shopify shop domain must use a *.myshopify.com hostname.",
      });
    }
  });

export const ShopifyAdminApiVersionSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Shopify Admin API version must use YYYY-MM format.");

export const ShopifyCustomAppClientCredentialsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(ShopifyConnectionMethodIds.CUSTOM_APP_CLIENT_CREDENTIALS),
    shop_domain: ShopifyShopDomainSchema,
    admin_api_version: ShopifyAdminApiVersionSchema,
    client_id: z.string().trim().min(1),
  })
  .strict();

export const ShopifyConnectionConfigSchema =
  ShopifyCustomAppClientCredentialsConnectionConfigSchema;

export type ShopifyConnectionConfig = z.output<typeof ShopifyConnectionConfigSchema>;

export function normalizeShopifyShopDomain(shopDomain: string): string {
  return ShopifyShopDomainSchema.parse(shopDomain).toLowerCase();
}

export function resolveShopifyAdminBaseUrl(input: {
  shopDomain: string;
  adminApiVersion: string;
}): string {
  const normalizedShopDomain = normalizeShopifyShopDomain(input.shopDomain);
  const adminApiVersion = ShopifyAdminApiVersionSchema.parse(input.adminApiVersion);
  return `https://${normalizedShopDomain}/admin/api/${adminApiVersion}`;
}
