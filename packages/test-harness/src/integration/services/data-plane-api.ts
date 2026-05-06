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
    serviceReferences:
      options.sandbox === undefined
        ? [ServiceIds.CONTROL_PLANE_API]
        : [ServiceIds.CONTROL_PLANE_API, ServiceIds.TOKENIZER_PROXY],
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
        tokenizerProxyBaseUrl:
          input.sandbox === undefined ? undefined : peer.url(ServiceIds.TOKENIZER_PROXY),
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
  tokenizerProxyBaseUrl: string | undefined;
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
      provider: input.sandbox?.provider ?? "docker",
      egress: {
        tokenSecret: "integration-new-egress-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-tokenizer-proxy",
      },
      tokenizerProxyEgressBaseUrl: createSandboxTokenizerProxyEgressUrl({
        baseUrl: input.tokenizerProxyBaseUrl,
        environmentId: input.environmentId,
        sandbox: input.sandbox,
      }),
      ...(input.sandbox?.provider === "e2b"
        ? {
            e2b: requireE2BOptions(input.sandbox),
          }
        : {
            docker: {
              socketPath: DockerSocketPath,
            },
          }),
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

function createSandboxTokenizerProxyEgressUrl(input: {
  baseUrl: string | undefined;
  environmentId: string;
  sandbox: IntegrationSandboxOptions | undefined;
}): string {
  if (input.sandbox === undefined) {
    return "http://127.0.0.1:5004/tokenizer-proxy/egress";
  }
  if (input.baseUrl === undefined) {
    throw new Error("Sandbox-enabled data-plane-api requires tokenizer-proxy service access.");
  }

  const url = new URL(
    `/__test-environments/${encodeURIComponent(input.environmentId)}/tokenizer-proxy/egress`,
    input.sandbox.provider === "e2b"
      ? readPublicTokenizerProxyBaseUrl(input.sandbox)
      : input.baseUrl,
  );

  if (input.sandbox.provider === "docker") {
    url.hostname = "host.docker.internal";
  }

  return url.toString().replace(/\/$/u, "");
}

function readPublicTokenizerProxyBaseUrl(input: IntegrationSandboxOptions): string {
  const publicTokenizerProxyBaseUrl = input.publicServiceBaseUrls?.get(ServiceIds.TOKENIZER_PROXY);
  if (publicTokenizerProxyBaseUrl === undefined) {
    throw new Error("E2B sandbox refresh requires public access for tokenizer-proxy.");
  }

  return publicTokenizerProxyBaseUrl;
}

function requireE2BOptions(input: IntegrationSandboxOptions): {
  apiKey: string;
  domain: string;
} {
  if (input.e2b === undefined) {
    throw new Error("data-plane-api requires E2B sandbox options when provider is e2b.");
  }

  return {
    apiKey: input.e2b.apiKey,
    domain: input.e2b.domain ?? "e2b.app",
  };
}
