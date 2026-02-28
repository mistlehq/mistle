import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";

export const OpenAiApiKeyCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const OpenAiApiKeySupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY];
