import {
  AgentMailMcpBaseDefinition,
  type AgentMailMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { AgentMailMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const AgentMailDefinition: AgentMailMcpBaseIntegrationDefinition = {
  ...AgentMailMcpBaseDefinition,
  oauth2AuthorizationCode: AgentMailMcpOAuth2AuthorizationCodeCapability,
};
