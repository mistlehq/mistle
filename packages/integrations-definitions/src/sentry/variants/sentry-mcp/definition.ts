import {
  SentryMcpBaseDefinition,
  type SentryMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { SentryMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const SentryDefinition: SentryMcpBaseIntegrationDefinition = {
  ...SentryMcpBaseDefinition,
  oauth2AuthorizationCode: SentryMcpOAuth2AuthorizationCodeCapability,
};
