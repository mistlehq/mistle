import { AwsAssumeRoleSessionCredentialResolver } from "../../shared/credential-resolver.server.js";
import { AwsCredentialResolverKeys } from "./auth.js";
import { AwsBaseDefinition, type AwsBaseIntegrationDefinition } from "./base-definition.js";

export const AwsDefinition: AwsBaseIntegrationDefinition = {
  ...AwsBaseDefinition,
  credentialResolvers: {
    custom: {
      [AwsCredentialResolverKeys.ASSUME_ROLE_SESSION]: AwsAssumeRoleSessionCredentialResolver,
    },
  },
};
