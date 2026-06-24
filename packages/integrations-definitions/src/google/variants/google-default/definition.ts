import { GoogleBaseDefinition, type GoogleBaseIntegrationDefinition } from "./base-definition.js";
import {
  GoogleAuthorizationRevocationCapability,
  GoogleOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";
import { GoogleServiceAccountCredentialResolver } from "./service-account-credential-resolver.server.js";

export const GoogleDefinition: GoogleBaseIntegrationDefinition = {
  ...GoogleBaseDefinition,
  oauth2AuthorizationCode: GoogleOAuth2AuthorizationCodeCapability,
  authorizationRevocation: GoogleAuthorizationRevocationCapability,
  credentialResolvers: {
    default: GoogleServiceAccountCredentialResolver,
  },
};
