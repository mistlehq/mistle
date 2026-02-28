import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";

export const GitHubEnterpriseServerCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const GitHubEnterpriseServerSupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY];
