import {
  GoogleAnalyticsMcpBaseDefinition,
  type GoogleAnalyticsMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import {
  GoogleAnalyticsMcpAuthorizationRevocationCapability,
  GoogleAnalyticsMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const GoogleAnalyticsDefinition: GoogleAnalyticsMcpBaseIntegrationDefinition = {
  ...GoogleAnalyticsMcpBaseDefinition,
  oauth2AuthorizationCode: GoogleAnalyticsMcpOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GoogleAnalyticsMcpAuthorizationRevocationCapability,
};
