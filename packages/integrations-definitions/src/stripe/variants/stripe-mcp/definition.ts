import {
  StripeMcpBaseDefinition,
  type StripeMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { StripeMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const StripeDefinition: StripeMcpBaseIntegrationDefinition = {
  ...StripeMcpBaseDefinition,
  oauth2AuthorizationCode: StripeMcpOAuth2AuthorizationCodeCapability,
};
