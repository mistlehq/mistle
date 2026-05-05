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

export function service(infra: readonly TestInfraRequirement[]): TestServiceDefinition {
  return {
    id: ServiceIds.DATA_PLANE_API,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API],
    endpoints: {
      http: {
        host: Host,
      },
    },
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.DATA_PLANE_API),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.DATA_PLANE_API),
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
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
        controlPlaneBaseUrl: peer.url(ServiceIds.CONTROL_PLANE_API),
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
  controlPlaneBaseUrl: string;
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
      provider: "docker",
      egress: {
        tokenSecret: "integration-egress-token-secret",
        tokenIssuer: "mistle",
        tokenAudience: "tokenizer-proxy",
      },
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      docker: {
        socketPath: DockerSocketPath,
      },
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
