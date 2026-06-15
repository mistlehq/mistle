import {
  NotionMcpBaseDefinition,
  type NotionMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { NotionMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const NotionDefinition: NotionMcpBaseIntegrationDefinition = {
  ...NotionMcpBaseDefinition,
  oauth2AuthorizationCode: NotionMcpOAuth2AuthorizationCodeCapability,
};
