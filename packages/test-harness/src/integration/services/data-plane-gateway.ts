import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { createDataPlaneGatewayRuntime } from "@mistle/data-plane-gateway/runtime";
import type { DataPlaneGatewayConfig } from "@mistle/data-plane-gateway/types";
import { initializeTelemetryFromConfig } from "@mistle/telemetry";

import type {
  ResolvedTestInfra,
  TestInfraRequirement,
  TestService,
  TestServiceDefinition,
  TestServiceStartInput,
} from "../../environment/index.js";
import { TestEnvironmentIdHeader } from "../../environment/test-isolation.js";
import { createGatewayWsUrl } from "./data-plane-gateway-sandbox-url.js";
import type {
  IntegrationDataPlaneGatewayRelayOptions,
  IntegrationServiceOptions,
  IntegrationSandboxOptions,
} from "./options.js";
import { peers } from "./peers.js";
import { ServiceIds } from "./service-ids.js";
import {
  assertMode,
  httpEndpoint,
  httpHealth,
  infraRequirement,
  infraValue,
  resolvedInfra,
} from "./shared.js";

const Host = "127.0.0.1";
const DockerSandboxReachableHost = "0.0.0.0";

const InfraIds = {
  NATS: "nats",
  OTLP: "otlp",
  POSTGRES: "postgres.data-plane",
  SANDBOX_BASE_IMAGE: "sandbox-base-image",
  VALKEY: "valkey",
};

const PostgresValues = {
  HOST_POOLED_URL: "host.pooledUrl",
};

const ValkeyValues = {
  HOST_URL: "host.url",
  KEY_PREFIX: "keyPrefix",
};

const OtlpValues = {
  TRACES_ENDPOINT: "traces.endpoint",
  LOGS_ENDPOINT: "logs.endpoint",
  METRICS_ENDPOINT: "metrics.endpoint",
};

const NatsValues = {
  URL: "url",
};

const SandboxBaseImageValues = {
  IMAGE_REF: "image.ref",
};

export function service(
  infra: readonly TestInfraRequirement[],
  options: IntegrationServiceOptions,
): TestServiceDefinition {
  return {
    id: ServiceIds.DATA_PLANE_GATEWAY,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API, ServiceIds.DATA_PLANE_API],
    endpoints: {
      http: {
        host: Host,
        bindHost: serverHostForSandbox(options.sandbox),
      },
    },
    poolScope: "environment",
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.DATA_PLANE_GATEWAY),
    start: start({
      dataPlaneGateway: options.dataPlaneGateway,
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.DATA_PLANE_GATEWAY),
      valkeyInfra: infraRequirement(infra, InfraIds.VALKEY, ServiceIds.DATA_PLANE_GATEWAY),
      sandbox: options.sandbox,
    }),
  };
}

function start(input: {
  dataPlaneGateway: IntegrationServiceOptions["dataPlaneGateway"] | undefined;
  postgresInfra: TestInfraRequirement;
  valkeyInfra: TestInfraRequirement;
  sandbox: IntegrationSandboxOptions | undefined;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    assertMode(startInput.mode, "runtime", ServiceIds.DATA_PLANE_GATEWAY);

    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const otlp = startInput.infra.get(InfraIds.OTLP);
    const sandboxBaseImage = startInput.infra.get(InfraIds.SANDBOX_BASE_IMAGE);
    const valkey = resolvedInfra(startInput.infra, input.valkeyInfra.id);
    const endpoint = httpEndpoint(startInput, ServiceIds.DATA_PLANE_GATEWAY);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const appConfig = config({
      host: serverHostForSandbox(input.sandbox),
      port: endpoint.port,
      postgres,
      otlp,
      sandboxBaseImage,
      valkey,
      dataPlaneApiBaseUrl: peer.url(ServiceIds.DATA_PLANE_API),
      controlPlaneBaseUrl: peer.url(ServiceIds.CONTROL_PLANE_API),
      gatewayWsUrl: createGatewayWsUrl({
        sandbox: input.sandbox,
        peer,
      }),
      gatewayRelay: input.dataPlaneGateway?.gatewayRelay,
      directEgressTrustedCaCertificates:
        input.dataPlaneGateway?.directEgress?.trustedCaCertificates,
      nats: startInput.infra.get(InfraIds.NATS),
      sandbox: input.sandbox,
    });
    const telemetry =
      otlp === undefined
        ? undefined
        : initializeTelemetryFromConfig({
            serviceName: "@mistle/data-plane-gateway",
            config: appConfig.telemetry,
          });
    const runtime = createDataPlaneGatewayRuntime({
      app: appConfig,
    });

    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop();
      await telemetry?.shutdown();
      throw error;
    }

    return {
      id: ServiceIds.DATA_PLANE_GATEWAY,
      mode: startInput.mode,
      endpoints: {
        http: {
          hostBaseUrl: endpoint.hostBaseUrl,
          internalBaseUrl: endpoint.hostBaseUrl,
        },
      },
      stop: async () => {
        await runtime.stop();
        await telemetry?.shutdown();
      },
    };
  };
}

function config(input: {
  host: string;
  port: number;
  postgres: ResolvedTestInfra;
  otlp: ResolvedTestInfra | undefined;
  sandboxBaseImage: ResolvedTestInfra | undefined;
  valkey: ResolvedTestInfra;
  dataPlaneApiBaseUrl: string;
  controlPlaneBaseUrl: string;
  directEgressTrustedCaCertificates: readonly string[] | undefined;
  gatewayWsUrl: string;
  gatewayRelay: IntegrationDataPlaneGatewayRelayOptions | undefined;
  nats: ResolvedTestInfra | undefined;
  sandbox: IntegrationSandboxOptions | undefined;
}): DataPlaneGatewayConfig {
  const gatewayRelay = resolveGatewayRelayConfig({
    gatewayRelay: input.gatewayRelay,
    nats: input.nats,
  });

  return {
    server: {
      host: input.host,
      port: input.port,
    },
    database: {
      url: infraValue(input.postgres, PostgresValues.HOST_POOLED_URL),
    },
    __dangerouslyEnableTestIsolation: {
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
    ...(input.directEgressTrustedCaCertificates === undefined
      ? {}
      : {
          __dangerouslyTrustDirectEgressTlsCaCertificates: input.directEgressTrustedCaCertificates,
        }),
    runtimeState: {
      backend: "valkey",
      valkey: {
        url: infraValue(input.valkey, ValkeyValues.HOST_URL),
        keyPrefix: infraValue(input.valkey, ValkeyValues.KEY_PREFIX),
      },
    },
    gatewayRelay,
    dataPlaneApi: {
      baseUrl: input.dataPlaneApiBaseUrl,
    },
    controlPlaneApi: {
      baseUrl: input.controlPlaneBaseUrl,
      publicBaseUrl: input.controlPlaneBaseUrl,
    },
    internalAuth: {
      serviceToken: "integration-new-internal-service-token",
    },
    sandbox: {
      defaultBaseImage: readSandboxBaseImageRef({
        sandbox: input.sandbox,
        sandboxBaseImage: input.sandboxBaseImage,
      }),
      gatewayWsUrl: input.gatewayWsUrl,
      internalGatewayWsUrl: input.gatewayWsUrl,
      connect: {
        tokenSecret: "integration-new-connection-secret",
        tokenIssuer: "integration-new-control-plane-api",
        tokenAudience: "integration-new-data-plane-gateway",
      },
      bootstrap: {
        tokenSecret: "integration-new-bootstrap-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-data-plane-gateway",
      },
      egress: {
        tokenSecret: "integration-new-egress-token-secret",
        tokenIssuer: "integration-new-data-plane-gateway",
        tokenAudience: "integration-new-gateway-egress",
      },
      ptyTransport: {
        tokenSecret: "integration-new-pty-token-secret",
        tokenIssuer: "integration-new-data-plane-gateway",
        tokenAudience: "integration-new-gateway-pty",
      },
      publish: {
        baseDomain: "mistle.localhost",
        access: {
          tokenSecret: "integration-new-port-access-secret",
          tokenIssuer: "integration-new-control-plane-api",
          tokenAudience: "integration-new-data-plane-gateway",
        },
        session: {
          cookieSigningSecret: "integration-new-port-access-cookie-secret",
        },
      },
    },
    telemetry:
      input.otlp === undefined
        ? {
            enabled: false,
            debug: false,
          }
        : {
            enabled: true,
            debug: false,
            traces: {
              endpoint: infraValue(input.otlp, OtlpValues.TRACES_ENDPOINT),
            },
            logs: {
              endpoint: infraValue(input.otlp, OtlpValues.LOGS_ENDPOINT),
            },
            metrics: {
              endpoint: infraValue(input.otlp, OtlpValues.METRICS_ENDPOINT),
            },
            resourceAttributes: "deployment.environment=integration-new",
          },
  };
}

function resolveGatewayRelayConfig(input: {
  gatewayRelay: IntegrationDataPlaneGatewayRelayOptions | undefined;
  nats: ResolvedTestInfra | undefined;
}): DataPlaneGatewayConfig["gatewayRelay"] {
  if (input.gatewayRelay === undefined || input.gatewayRelay.backend === "memory") {
    return {
      backend: "memory",
    };
  }
  if (input.nats === undefined) {
    throw new Error("NATS infra is required when data-plane gateway relay backend is 'nats'.");
  }

  return {
    backend: "nats",
    nats: {
      url: infraValue(input.nats, NatsValues.URL),
      namePrefix: input.gatewayRelay.namePrefix,
    },
  };
}

function serverHostForSandbox(sandbox: IntegrationSandboxOptions | undefined): string {
  if (sandbox?.provider === "docker") {
    return DockerSandboxReachableHost;
  }

  return Host;
}

function readSandboxBaseImageRef(input: {
  sandbox: IntegrationSandboxOptions | undefined;
  sandboxBaseImage: ResolvedTestInfra | undefined;
}): string {
  if (input.sandbox?.defaultBaseImageRef !== undefined) {
    return input.sandbox.defaultBaseImageRef;
  }

  if (input.sandboxBaseImage !== undefined) {
    return infraValue(input.sandboxBaseImage, SandboxBaseImageValues.IMAGE_REF);
  }

  return getLocalDevDockerRegistrySandboxBaseImageRef();
}
