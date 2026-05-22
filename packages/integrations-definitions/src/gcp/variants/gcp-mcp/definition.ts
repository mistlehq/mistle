import { GcpMcpBaseDefinition, type GcpMcpBaseIntegrationDefinition } from "./base-definition.js";
import {
  GcpMcpAuthorizationRevocationCapability,
  GcpMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const GcpDefinition: GcpMcpBaseIntegrationDefinition = {
  ...GcpMcpBaseDefinition,
  oauth2AuthorizationCode: GcpMcpOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GcpMcpAuthorizationRevocationCapability,
};
