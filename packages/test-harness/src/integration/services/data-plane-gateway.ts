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

const InfraIds = {
  OTLP: "otlp",
  POSTGRES: "postgres.data-plane",
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

export function service(infra: readonly TestInfraRequirement[]): TestServiceDefinition {
  return {
    id: ServiceIds.DATA_PLANE_GATEWAY,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API, ServiceIds.DATA_PLANE_API],
    endpoints: {
      http: {
        host: Host,
      },
    },
    ...(infra.some((requirement) => requirement.id === InfraIds.OTLP)
      ? {
          poolScope: "environment",
        }
      : {}),
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.DATA_PLANE_GATEWAY),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.DATA_PLANE_GATEWAY),
      valkeyInfra: infraRequirement(infra, InfraIds.VALKEY, ServiceIds.DATA_PLANE_GATEWAY),
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
  valkeyInfra: TestInfraRequirement;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    assertMode(startInput.mode, "runtime", ServiceIds.DATA_PLANE_GATEWAY);

    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const otlp = startInput.infra.get(InfraIds.OTLP);
    const valkey = resolvedInfra(startInput.infra, input.valkeyInfra.id);
    const endpoint = httpEndpoint(startInput, ServiceIds.DATA_PLANE_GATEWAY);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const appConfig = config({
      port: endpoint.port,
      postgres,
      otlp,
      valkey,
      dataPlaneApiBaseUrl: peer.url(ServiceIds.DATA_PLANE_API),
      controlPlaneBaseUrl: peer.url(ServiceIds.CONTROL_PLANE_API),
      gatewayWsUrl: peer.ws(ServiceIds.DATA_PLANE_GATEWAY, "/tunnel/sandbox"),
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
  port: number;
  postgres: ResolvedTestInfra;
  otlp: ResolvedTestInfra | undefined;
  valkey: ResolvedTestInfra;
  dataPlaneApiBaseUrl: string;
  controlPlaneBaseUrl: string;
  gatewayWsUrl: string;
}): DataPlaneGatewayConfig {
  return {
    server: {
      host: Host,
      port: input.port,
    },
    database: {
      url: infraValue(input.postgres, PostgresValues.HOST_POOLED_URL),
    },
    __dangerouslyEnableTestIsolation: {
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
    runtimeState: {
      backend: "valkey",
      valkey: {
        url: infraValue(input.valkey, ValkeyValues.HOST_URL),
        keyPrefix: infraValue(input.valkey, ValkeyValues.KEY_PREFIX),
      },
    },
    dataPlaneApi: {
      baseUrl: input.dataPlaneApiBaseUrl,
    },
    controlPlaneApi: {
      baseUrl: input.controlPlaneBaseUrl,
    },
    internalAuth: {
      serviceToken: "integration-new-internal-service-token",
    },
    sandbox: {
      provider: "docker",
      defaultBaseImage: getLocalDevDockerRegistrySandboxBaseImageRef(),
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
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-tokenizer-proxy",
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
