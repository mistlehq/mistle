import {
  GoogleBusinessProfileMcpBaseDefinition,
  type GoogleBusinessProfileMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import {
  GoogleBusinessProfileMcpAuthorizationRevocationCapability,
  GoogleBusinessProfileMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const GoogleBusinessProfileDefinition: GoogleBusinessProfileMcpBaseIntegrationDefinition = {
  ...GoogleBusinessProfileMcpBaseDefinition,
  oauth2AuthorizationCode: GoogleBusinessProfileMcpOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GoogleBusinessProfileMcpAuthorizationRevocationCapability,
};
