import { GatewayHttpSandboxBootstrapAttachmentTerminator } from "./adapters/gateway-http-sandbox-bootstrap-attachment-terminator.js";
import type { SandboxBootstrapAttachmentTerminator } from "./sandbox-bootstrap-attachment-terminator.js";

export function createSandboxBootstrapAttachmentTerminator(input: {
  gatewayBaseUrl: string;
  serviceToken: string;
  testEnvironmentId?: string;
  testEnvironmentIdHeader?: string;
}): SandboxBootstrapAttachmentTerminator {
  return new GatewayHttpSandboxBootstrapAttachmentTerminator({
    baseUrl: input.gatewayBaseUrl,
    serviceToken: input.serviceToken,
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
    ...(input.testEnvironmentIdHeader === undefined
      ? {}
      : { testEnvironmentIdHeader: input.testEnvironmentIdHeader }),
  });
}
