import {
  DataForSeoMcpBaseDefinition,
  type DataForSeoMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { DataForSeoMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const DataForSeoDefinition: DataForSeoMcpBaseIntegrationDefinition = {
  ...DataForSeoMcpBaseDefinition,
  oauth2AuthorizationCode: DataForSeoMcpOAuth2AuthorizationCodeCapability,
};
