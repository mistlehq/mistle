import {
  PostHogMcpBaseDefinition,
  type PostHogMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { PostHogMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const PostHogDefinition: PostHogMcpBaseIntegrationDefinition = {
  ...PostHogMcpBaseDefinition,
  oauth2AuthorizationCode: PostHogMcpOAuth2AuthorizationCodeCapability,
};
