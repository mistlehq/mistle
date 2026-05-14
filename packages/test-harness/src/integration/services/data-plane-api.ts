import { createDataPlaneApiRuntime } from "@mistle/data-plane-api/runtime";
import type { DataPlaneApiConfig } from "@mistle/data-plane-api/types";

import type {
  ResolvedTestInfra,
  TestInfraRequirement,
  TestService,
  TestServiceDefinition,
  TestServiceStartInput,
} from "../../environment/index.js";
import { TestEnvironmentIdHeader } from "../../environment/test-isolation.js";
import type { IntegrationServiceOptions, IntegrationSandboxOptions } from "./options.js";
import { peers } from "./peers.js";
import { ServiceIds } from "./service-ids.js";
import {
  assertMode,
  httpEndpoint,
  httpHealth,
  infraValue,
  infraRequirement,
  resolvedInfra,
} from "./shared.js";

const Host = "127.0.0.1";
const DockerSocketPath = "/var/run/docker.sock";

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
  DATA_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.dataPlaneNamespaceId",
};

const InfraIds = {
  POSTGRES: "postgres.data-plane",
};

export function service(
  infra: readonly TestInfraRequirement[],
  options: IntegrationServiceOptions,
): TestServiceDefinition {
  return {
    id: ServiceIds.DATA_PLANE_API,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API],
    endpoints: {
      http: {
        host: Host,
      },
    },
    ...(options.sandbox === undefined ? {} : { poolScope: "environment" }),
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.DATA_PLANE_API),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.DATA_PLANE_API),
      sandbox: options.sandbox,
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
  sandbox: IntegrationSandboxOptions | undefined;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    assertMode(startInput.mode, "runtime", ServiceIds.DATA_PLANE_API);

    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const endpoint = httpEndpoint(startInput, ServiceIds.DATA_PLANE_API);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const runtime = await createDataPlaneApiRuntime({
      app: config({
        port: endpoint.port,
        postgres,
        gatewayBaseUrl: peer.url(ServiceIds.DATA_PLANE_GATEWAY),
        environmentId: startInput.environmentId,
        controlPlaneBaseUrl: peer.url(ServiceIds.CONTROL_PLANE_API),
        sandbox: input.sandbox,
      }),
    });

    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop();
      throw error;
    }

    return {
      id: ServiceIds.DATA_PLANE_API,
      mode: startInput.mode,
      endpoints: {
        http: {
          hostBaseUrl: endpoint.hostBaseUrl,
          internalBaseUrl: endpoint.hostBaseUrl,
        },
      },
      stop: runtime.stop,
    };
  };
}

function config(input: {
  port: number;
  postgres: ResolvedTestInfra;
  gatewayBaseUrl: string;
  environmentId: string;
  controlPlaneBaseUrl: string;
  sandbox: IntegrationSandboxOptions | undefined;
}): DataPlaneApiConfig {
  const pooledUrl = infraValue(input.postgres, PostgresValues.HOST_POOLED_URL);
  const directUrl = infraValue(input.postgres, PostgresValues.HOST_DIRECT_URL);

  return {
    server: {
      host: Host,
      port: input.port,
    },
    database: {
      url: pooledUrl,
      migrationUrl: directUrl,
    },
    workflow: {
      databaseUrl: directUrl,
      migrationUrl: directUrl,
      namespaceId: infraValue(input.postgres, PostgresValues.DATA_PLANE_WORKFLOW_NAMESPACE_ID),
    },
    runtimeState: {
      gatewayBaseUrl: input.gatewayBaseUrl,
    },
    sandbox: {
      ...createDataPlaneApiSandboxProviderConfig(input.sandbox),
    },
    controlPlaneApi: {
      baseUrl: input.controlPlaneBaseUrl,
    },
    internalAuth: {
      serviceToken: "integration-new-internal-service-token",
    },
    __dangerouslyEnableTestIsolation: {
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
  };
}

function createDataPlaneApiSandboxProviderConfig(input: IntegrationSandboxOptions | undefined):
  | {
      docker: { enabled: true; socketPath: string };
    }
  | {
      e2b: { enabled: true; apiKey: string; domain: string };
    }
  | {
      tensorlake: { enabled: true; apiKey: string };
    } {
  if (input?.provider === "e2b") {
    return { e2b: requireE2BOptions(input) };
  }

  if (input?.provider === "tensorlake") {
    return { tensorlake: requireTensorlakeOptions(input) };
  }

  return { docker: { enabled: true, socketPath: DockerSocketPath } };
}

function requireTensorlakeOptions(input: IntegrationSandboxOptions): {
  enabled: true;
  apiKey: string;
} {
  if (input.tensorlake === undefined) {
    throw new Error(
      "data-plane-api requires Tensorlake sandbox options when provider is tensorlake.",
    );
  }

  return { enabled: true, apiKey: input.tensorlake.apiKey };
}

function requireE2BOptions(input: IntegrationSandboxOptions): {
  enabled: true;
  apiKey: string;
  domain: string;
} {
  if (input.e2b === undefined) {
    throw new Error("data-plane-api requires E2B sandbox options when provider is e2b.");
  }

  return {
    enabled: true,
    apiKey: input.e2b.apiKey,
    domain: input.e2b.domain ?? "e2b.app",
  };
}
