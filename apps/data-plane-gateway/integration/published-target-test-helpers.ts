import { derivePublishedTargetHost } from "@mistle/published-target-auth";

import type { DataPlaneGatewayIntegrationFixture } from "./test-context.js";

export function deriveIntegrationPublishedHost(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  port: number;
  sandboxInstanceId: string;
}): string {
  return derivePublishedTargetHost({
    baseDomain: input.fixture.config.sandbox.publish.baseDomain,
    sandboxInstanceId: input.sandboxInstanceId,
    target: {
      kind: "port",
      port: input.port,
    },
  });
}

export function createPublishedHttpUrl(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): URL {
  const url = new URL(input.path, input.fixture.baseUrl);
  url.hostname = input.host;
  return url;
}

export function createPublishedWebSocketUrl(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): string {
  const url = new URL(input.path, input.fixture.websocketBaseUrl);
  url.hostname = input.host;
  return url.toString();
}
