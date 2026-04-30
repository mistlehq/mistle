/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures; it does not declare test cases directly.
 */

import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import {
  createMistlePostgresInfraRequirement,
  createServiceRegistry,
  MistlePostgresInfraValues,
  MistleTestInfraIds,
  reserveAvailablePort,
  startTestEnvironment,
  type ResolvedTestInfra,
  type TestEnvironment,
  type TestHttpClient,
  type TestService,
  type TestServiceHandle,
  type TestServiceRuntime,
  type TestServiceStartInput,
} from "@mistle/test-harness";
import { it as base } from "vitest";

import { createControlPlaneApiRuntime } from "../src/main.js";
import type { ControlPlaneApiConfig } from "../src/types.js";

const ControlPlaneApiServiceId = "control-plane-api";
const ControlPlaneHost = "127.0.0.1";
const DataPlaneHost = "127.0.0.1";

type ControlPlaneApiServiceHandle = TestServiceHandle & {
  http: TestHttpClient;
  hostBaseUrl: string;
};

type ControlPlaneApiIntegrationNewEnvironment = TestEnvironment<typeof ControlPlaneApiServiceId>;

type ControlPlaneApiIntegrationNewFixture = {
  controlPlaneApi: ControlPlaneApiServiceHandle;
  environment: ControlPlaneApiIntegrationNewEnvironment;
  trustedOrigin: string;
};

const postgres = createMistlePostgresInfraRequirement();

export const it = base.extend<ControlPlaneApiIntegrationNewFixture>({
  environment: [
    async ({}, use) => {
      const environment = await startTestEnvironment({
        registry: createServiceRegistry({
          services: {
            [ControlPlaneApiServiceId]: {
              id: ControlPlaneApiServiceId,
              infra: [postgres],
              serviceReferences: [],
              supportedModes: ["runtime"],
              healthCheck: async (service) =>
                checkHttpServiceHealth(service, ControlPlaneApiServiceId),
              start: startControlPlaneApiRuntimeService,
            },
          },
        }),
        services: [{ service: ControlPlaneApiServiceId, mode: "runtime" }],
      });

      try {
        await use(environment);
      } finally {
        await environment.stop();
      }
    },
    {
      scope: "file",
    },
  ],
  controlPlaneApi: [
    async ({ environment }, use) => {
      const service = environment.services.get(ControlPlaneApiServiceId);
      const http = service.http;
      const httpEndpoint = service.endpoints.http;
      if (http === undefined || httpEndpoint === undefined) {
        throw new Error(`${ControlPlaneApiServiceId} must expose an HTTP endpoint and client.`);
      }

      await use({
        ...service,
        http,
        hostBaseUrl: httpEndpoint.hostBaseUrl,
      });
    },
    {
      scope: "file",
    },
  ],
  trustedOrigin: [
    async ({ controlPlaneApi }, use) => {
      await use(controlPlaneApi.hostBaseUrl);
    },
    {
      scope: "file",
    },
  ],
});

async function startControlPlaneApiRuntimeService(
  input: TestServiceStartInput,
): Promise<TestService> {
  if (input.mode !== "runtime") {
    throw new Error(`${ControlPlaneApiServiceId} supports runtime mode in integration-new tests.`);
  }

  const postgresInfra = readResolvedInfra(input.infra, MistleTestInfraIds.POSTGRES);
  const controlPlanePort = await reserveAvailablePort({ host: ControlPlaneHost });
  const controlPlaneBaseUrl = `http://${ControlPlaneHost}:${String(controlPlanePort)}`;
  const dataPlanePort = await reserveAvailablePort({ host: DataPlaneHost });
  const dataPlaneBaseUrl = `http://${DataPlaneHost}:${String(dataPlanePort)}`;
  const config = createControlPlaneApiConfig({
    controlPlaneBaseUrl,
    controlPlanePort,
    dataPlaneBaseUrl,
    postgres: postgresInfra,
  });
  const runtime = await createControlPlaneApiRuntime({
    app: config,
  });

  try {
    await runtime.start();
  } catch (error) {
    await runtime.stop();
    throw error;
  }

  return {
    id: ControlPlaneApiServiceId,
    mode: input.mode,
    endpoints: {
      http: {
        hostBaseUrl: controlPlaneBaseUrl,
        internalBaseUrl: controlPlaneBaseUrl,
      },
    },
    stop: runtime.stop,
  };
}

function createControlPlaneApiConfig(input: {
  controlPlaneBaseUrl: string;
  controlPlanePort: number;
  dataPlaneBaseUrl: string;
  postgres: ResolvedTestInfra;
}): ControlPlaneApiConfig {
  const hostPooledUrl = readResolvedInfraValue(
    input.postgres,
    MistlePostgresInfraValues.HOST_POOLED_URL,
  );
  const hostDirectUrl = readResolvedInfraValue(
    input.postgres,
    MistlePostgresInfraValues.HOST_DIRECT_URL,
  );

  return {
    server: {
      host: ControlPlaneHost,
      port: input.controlPlanePort,
    },
    database: {
      url: hostPooledUrl,
      migrationUrl: hostDirectUrl,
    },
    objectStore: {
      bucketName: "integration-new-media",
      region: "us-east-1",
      endpoint: "http://127.0.0.1:8333",
      forcePathStyle: true,
      accessKeyId: "integration-new-access-key",
      secretAccessKey: "integration-new-secret-key",
    },
    workflow: {
      databaseUrl: hostPooledUrl,
      migrationUrl: hostDirectUrl,
      namespaceId: readResolvedInfraValue(
        input.postgres,
        MistlePostgresInfraValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID,
      ),
    },
    dataPlaneApi: {
      baseUrl: input.dataPlaneBaseUrl,
    },
    internalAuth: {
      serviceToken: "integration-new-internal-service-token",
    },
    connectionToken: {
      secret: "integration-new-connection-secret",
      issuer: "integration-new-issuer",
      audience: "integration-new-audience",
    },
    portAccess: {
      baseDomain: "mistle.localhost",
      gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      access: {
        tokenSecret: "integration-new-port-access-secret",
        tokenIssuer: "integration-new-control-plane-api",
        tokenAudience: "integration-new-data-plane-gateway",
      },
    },
    sandbox: {
      defaultBaseImage: getLocalDevDockerRegistrySandboxBaseImageRef(),
      gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-new-bootstrap-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-data-plane-gateway",
      },
    },
    integrations: {
      activeMasterEncryptionKeyVersion: 1,
      masterEncryptionKeys: {
        "1": "integration-new-master-key-testing",
      },
    },
    dashboard: {
      baseUrl: "http://localhost:5173",
    },
    auth: {
      baseUrl: input.controlPlaneBaseUrl,
      secret: "integration-new-auth-secret",
      trustedOrigins: [input.controlPlaneBaseUrl],
      otpLength: 6,
      otpExpiresInSeconds: 300,
      otpAllowedAttempts: 3,
    },
  };
}

function readResolvedInfra(
  infra: ReadonlyMap<string, ResolvedTestInfra>,
  infraId: string,
): ResolvedTestInfra {
  const resolvedInfra = infra.get(infraId);
  if (resolvedInfra === undefined) {
    throw new Error(`Expected test infra '${infraId}' to be resolved.`);
  }

  return resolvedInfra;
}

function readResolvedInfraValue(infra: ResolvedTestInfra, key: string): string {
  const value = infra.values.get(key);
  if (value === undefined) {
    throw new Error(`Expected test infra '${infra.id}' to expose value '${key}'.`);
  }

  return value;
}

async function checkHttpServiceHealth(
  service: TestServiceRuntime,
  serviceId: string,
): Promise<void> {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error(`Expected test service '${serviceId}' to expose an HTTP endpoint.`);
  }

  const response = await fetch(new URL("/__healthz", httpEndpoint.hostBaseUrl));
  if (!response.ok) {
    throw new Error(
      `Test service '${serviceId}' health check returned ${String(response.status)}.`,
    );
  }
}
