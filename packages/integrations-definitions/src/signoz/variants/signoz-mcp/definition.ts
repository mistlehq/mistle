import {
  SignozMcpBaseDefinition,
  type SignozMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { SignozMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const SignozDefinition: SignozMcpBaseIntegrationDefinition = {
  ...SignozMcpBaseDefinition,
  oauth2AuthorizationCode: SignozMcpOAuth2AuthorizationCodeCapability,
};
