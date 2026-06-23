import {
  KlaviyoMcpBaseDefinition,
  type KlaviyoMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { KlaviyoMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const KlaviyoDefinition: KlaviyoMcpBaseIntegrationDefinition = {
  ...KlaviyoMcpBaseDefinition,
  oauth2AuthorizationCode: KlaviyoMcpOAuth2AuthorizationCodeCapability,
};
