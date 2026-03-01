import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";

export const GitHubCloudCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const GitHubCloudSupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY];
