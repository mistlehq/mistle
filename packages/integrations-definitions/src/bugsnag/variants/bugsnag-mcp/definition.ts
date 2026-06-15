import {
  BugSnagMcpBaseDefinition,
  type BugSnagMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { BugSnagMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const BugSnagDefinition: BugSnagMcpBaseIntegrationDefinition = {
  ...BugSnagMcpBaseDefinition,
  oauth2AuthorizationCode: BugSnagMcpOAuth2AuthorizationCodeCapability,
};
