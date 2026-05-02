import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { createControlPlaneApiRuntime } from "@mistle/control-plane-api/runtime";
import type { ControlPlaneApiConfig } from "@mistle/control-plane-api/types";

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
import { httpEndpoint, httpHealth, infraRequirement, infraValue, resolvedInfra } from "./shared.js";

const ControlPlaneHost = "127.0.0.1";

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
  CONTROL_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.controlPlaneNamespaceId",
};

const InfraIds = {
  POSTGRES: "postgres.control-plane",
  SEAWEEDFS: "seaweedfs",
};

const SeaweedfsValues = {
  BUCKET_NAME: "bucketName",
  HOST_ENDPOINT: "host.endpoint",
  REGION: "region",
  ACCESS_KEY_ID: "accessKeyId",
  SECRET_ACCESS_KEY: "secretAccessKey",
};

export function service(infra: readonly TestInfraRequirement[]): TestServiceDefinition {
  return {
    id: ServiceIds.CONTROL_PLANE_API,
    infra,
    serviceReferences: [],
    endpoints: {
      http: {
        host: ControlPlaneHost,
      },
    },
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.CONTROL_PLANE_API),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.CONTROL_PLANE_API),
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    if (startInput.mode !== "runtime") {
      throw new Error(
        `${ServiceIds.CONTROL_PLANE_API} supports runtime mode in integration tests.`,
      );
    }

    const resolvedPostgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const resolvedSeaweedfs = startInput.infra.get(InfraIds.SEAWEEDFS);
    const endpoint = httpEndpoint(startInput, ServiceIds.CONTROL_PLANE_API);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const runtime = await createControlPlaneApiRuntime({
      app: config({
        controlPlaneBaseUrl: endpoint.hostBaseUrl,
        controlPlanePort: endpoint.port,
        dataPlaneBaseUrl: peer.url(ServiceIds.DATA_PLANE_API),
        gatewayWsUrl: peer.ws(ServiceIds.DATA_PLANE_GATEWAY, "/tunnel/sandbox"),
        postgres: resolvedPostgres,
        seaweedfs: resolvedSeaweedfs,
      }),
    });

    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop();
      throw error;
    }

    return {
      id: ServiceIds.CONTROL_PLANE_API,
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
  controlPlaneBaseUrl: string;
  controlPlanePort: number;
  dataPlaneBaseUrl: string;
  gatewayWsUrl: string;
  postgres: ResolvedTestInfra;
  seaweedfs: ResolvedTestInfra | undefined;
}): ControlPlaneApiConfig {
  const hostPooledUrl = infraValue(input.postgres, PostgresValues.HOST_POOLED_URL);
  const hostDirectUrl = infraValue(input.postgres, PostgresValues.HOST_DIRECT_URL);

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
      bucketName:
        input.seaweedfs === undefined
          ? "integration-new-media"
          : infraValue(input.seaweedfs, SeaweedfsValues.BUCKET_NAME),
      region:
        input.seaweedfs === undefined
          ? "us-east-1"
          : infraValue(input.seaweedfs, SeaweedfsValues.REGION),
      endpoint:
        input.seaweedfs === undefined
          ? "http://127.0.0.1:9"
          : infraValue(input.seaweedfs, SeaweedfsValues.HOST_ENDPOINT),
      forcePathStyle: true,
      accessKeyId:
        input.seaweedfs === undefined
          ? "integration-new-access-key"
          : infraValue(input.seaweedfs, SeaweedfsValues.ACCESS_KEY_ID),
      secretAccessKey:
        input.seaweedfs === undefined
          ? "integration-new-secret-key"
          : infraValue(input.seaweedfs, SeaweedfsValues.SECRET_ACCESS_KEY),
    },
    workflow: {
      databaseUrl: hostDirectUrl,
      migrationUrl: hostDirectUrl,
      namespaceId: infraValue(input.postgres, PostgresValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID),
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
      gatewayWsUrl: input.gatewayWsUrl,
      access: {
        tokenSecret: "integration-new-port-access-secret",
        tokenIssuer: "integration-new-control-plane-api",
        tokenAudience: "integration-new-data-plane-gateway",
      },
    },
    sandbox: {
      defaultBaseImage: getLocalDevDockerRegistrySandboxBaseImageRef(),
      gatewayWsUrl: input.gatewayWsUrl,
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
    __dangerouslyEnableTestIsolation: {
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
  };
}
