import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";

export const GitHubCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const GitHubSupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY];
