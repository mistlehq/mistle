export const IntegrationPortAccessConfig = {
  baseDomain: "mistle.localhost",
  access: {
    tokenSecret: "integration-port-access-secret",
    tokenIssuer: "integration-control-plane-api",
    tokenAudience: "integration-data-plane-gateway",
  },
} as const;
