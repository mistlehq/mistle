import { derivePublishedTargetHost } from "@mistle/gateway-published-target-auth";

import type { DataPlaneGatewayIntegrationFixture } from "./test-context.js";

function resolvePublishedBaseDomain(fixture: DataPlaneGatewayIntegrationFixture): string {
  return fixture.config.environment === "development"
    ? fixture.config.publish.localBaseDomain
    : fixture.config.publish.baseDomain;
}

export function deriveIntegrationPublishedHost(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  port: number;
  sandboxInstanceId: string;
}): string {
  return derivePublishedTargetHost({
    baseDomain: resolvePublishedBaseDomain(input.fixture),
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
