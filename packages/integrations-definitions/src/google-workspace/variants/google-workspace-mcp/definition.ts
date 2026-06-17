import {
  GoogleWorkspaceMcpBaseDefinition,
  type GoogleWorkspaceMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import {
  GoogleWorkspaceMcpAuthorizationRevocationCapability,
  GoogleWorkspaceMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const GoogleWorkspaceDefinition: GoogleWorkspaceMcpBaseIntegrationDefinition = {
  ...GoogleWorkspaceMcpBaseDefinition,
  oauth2AuthorizationCode: GoogleWorkspaceMcpOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GoogleWorkspaceMcpAuthorizationRevocationCapability,
};
