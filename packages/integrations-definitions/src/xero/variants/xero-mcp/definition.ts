import { XeroMcpBaseDefinition, type XeroMcpBaseIntegrationDefinition } from "./base-definition.js";
import {
  XeroMcpAuthorizationRevocationCapability,
  XeroMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

export const XeroDefinition: XeroMcpBaseIntegrationDefinition = {
  ...XeroMcpBaseDefinition,
  oauth2AuthorizationCode: XeroMcpOAuth2AuthorizationCodeCapability,
  authorizationRevocation: XeroMcpAuthorizationRevocationCapability,
};
