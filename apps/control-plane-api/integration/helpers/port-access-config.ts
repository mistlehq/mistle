export const IntegrationPortAccessConfig = {
  baseDomain: "mistle.localhost",
  gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
  access: {
    tokenSecret: "integration-port-access-secret",
    tokenIssuer: "integration-control-plane-api",
    tokenAudience: "integration-data-plane-gateway",
  },
} as const;
