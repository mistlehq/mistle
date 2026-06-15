import { ExpoMcpBaseDefinition, type ExpoMcpBaseIntegrationDefinition } from "./base-definition.js";
import { ExpoMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const ExpoDefinition: ExpoMcpBaseIntegrationDefinition = {
  ...ExpoMcpBaseDefinition,
  oauth2AuthorizationCode: ExpoMcpOAuth2AuthorizationCodeCapability,
};
