import {
  RailwayMcpBaseDefinition,
  type RailwayMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { RailwayMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const RailwayDefinition: RailwayMcpBaseIntegrationDefinition = {
  ...RailwayMcpBaseDefinition,
  oauth2AuthorizationCode: RailwayMcpOAuth2AuthorizationCodeCapability,
};
