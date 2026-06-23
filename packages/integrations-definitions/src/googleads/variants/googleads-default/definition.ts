import {
  GoogleAdsBaseDefinition,
  type GoogleAdsBaseIntegrationDefinition,
} from "./base-definition.js";
import {
  GoogleAdsAuthorizationRevocationCapability,
  GoogleAdsOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const GoogleAdsDefinition: GoogleAdsBaseIntegrationDefinition = {
  ...GoogleAdsBaseDefinition,
  oauth2AuthorizationCode: GoogleAdsOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GoogleAdsAuthorizationRevocationCapability,
};
