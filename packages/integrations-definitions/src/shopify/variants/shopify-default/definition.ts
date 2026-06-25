import { ShopifyBaseDefinition, type ShopifyBaseIntegrationDefinition } from "./base-definition.js";
import { ShopifyOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";
import { exchangeShopifyClientCredentials } from "./oauth2-client-credentials.server.js";

export const ShopifyDefinition: ShopifyBaseIntegrationDefinition = {
  ...ShopifyBaseDefinition,
  oauth2AuthorizationCode: ShopifyOAuth2AuthorizationCodeCapability,
  oauth2ClientCredentials: {
    exchangeClientCredentials: exchangeShopifyClientCredentials,
  },
};
