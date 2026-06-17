import {
  SupabaseMcpBaseDefinition,
  type SupabaseMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { SupabaseMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const SupabaseDefinition: SupabaseMcpBaseIntegrationDefinition = {
  ...SupabaseMcpBaseDefinition,
  oauth2AuthorizationCode: SupabaseMcpOAuth2AuthorizationCodeCapability,
};
