import { ShopifyBaseDefinition, type ShopifyBaseIntegrationDefinition } from "./base-definition.js";
import { exchangeShopifyClientCredentials } from "./oauth2-client-credentials.server.js";

export const ShopifyDefinition: ShopifyBaseIntegrationDefinition = {
  ...ShopifyBaseDefinition,
  oauth2ClientCredentials: {
    exchangeClientCredentials: exchangeShopifyClientCredentials,
  },
};
