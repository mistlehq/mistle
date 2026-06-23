import {
  GoogleSearchConsoleMcpBaseDefinition,
  type GoogleSearchConsoleMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import {
  GoogleSearchConsoleMcpAuthorizationRevocationCapability,
  GoogleSearchConsoleMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const GoogleSearchConsoleDefinition: GoogleSearchConsoleMcpBaseIntegrationDefinition = {
  ...GoogleSearchConsoleMcpBaseDefinition,
  oauth2AuthorizationCode: GoogleSearchConsoleMcpOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GoogleSearchConsoleMcpAuthorizationRevocationCapability,
};
