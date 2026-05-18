import { fileURLToPath } from "node:url";

import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { createControlPlaneApiRuntime } from "@mistle/control-plane-api/runtime";
import type { ControlPlaneApiConfig } from "@mistle/control-plane-api/types";
import { z } from "zod";

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
import { httpEndpoint, httpHealth, infraRequirement, infraValue, resolvedInfra } from "./shared.js";

const ControlPlaneHost = "127.0.0.1";
const DefaultE2BCloudDomain = "e2b.app";
const CommitSignBinaryPath = fileURLToPath(
  new URL("../../../../commit-sign/target/debug/commit-sign", import.meta.url),
);

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
  CONTROL_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.controlPlaneNamespaceId",
};

const InfraIds = {
  POSTGRES: "postgres.control-plane",
  SANDBOX_BASE_IMAGE: "sandbox-base-image",
  SEAWEEDFS: "seaweedfs",
};

const SandboxBaseImageValues = {
  IMAGE_REF: "image.ref",
};

const SeaweedfsValues = {
  BUCKET_NAME: "bucketName",
  HOST_ENDPOINT: "host.endpoint",
  REGION: "region",
  ACCESS_KEY_ID: "accessKeyId",
  SECRET_ACCESS_KEY: "secretAccessKey",
};

const SimulatedGoogleIdTokenSchema = z.object({
  aud: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  exp: z.number(),
  iss: z.union([z.literal("https://accounts.google.com"), z.literal("accounts.google.com")]),
  name: z.string().optional(),
  picture: z.string().optional(),
  sub: z.string(),
});

export function service(
  infra: readonly TestInfraRequirement[],
  options: IntegrationServiceOptions,
): TestServiceDefinition {
  const requiresEnvironmentScope =
    options.sandbox !== undefined ||
    options.controlPlaneApi?.billingStripeEnabled === true ||
    options.controlPlaneApi?.googleAuth === "simulated" ||
    options.controlPlaneApi?.allowSignups === false;

  return {
    id: ServiceIds.CONTROL_PLANE_API,
    infra,
    serviceReferences: [],
    endpoints: {
      http: {
        host: ControlPlaneHost,
      },
    },
    ...(requiresEnvironmentScope ? { poolScope: "environment" } : {}),
    supportedModes: ["runtime"],
    healthCheck: async (runtime) => httpHealth(runtime, ServiceIds.CONTROL_PLANE_API),
    start: start(
      options?.controlPlaneApi?.googleAuth === undefined
        ? {
            postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.CONTROL_PLANE_API),
            ...(options.controlPlaneApi?.allowSignups === undefined
              ? {}
              : { allowSignups: options.controlPlaneApi.allowSignups }),
            ...(options.controlPlaneApi?.billingStripeEnabled === undefined
              ? {}
              : { billingStripeEnabled: options.controlPlaneApi.billingStripeEnabled }),
            sandbox: options.sandbox,
          }
        : {
            postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.CONTROL_PLANE_API),
            googleAuth: options.controlPlaneApi.googleAuth,
            ...(options.controlPlaneApi.allowSignups === undefined
              ? {}
              : { allowSignups: options.controlPlaneApi.allowSignups }),
            ...(options.controlPlaneApi.billingStripeEnabled === undefined
              ? {}
              : { billingStripeEnabled: options.controlPlaneApi.billingStripeEnabled }),
            sandbox: options.sandbox,
          },
    ),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
  googleAuth?: "simulated";
  allowSignups?: boolean;
  billingStripeEnabled?: boolean;
  sandbox: IntegrationSandboxOptions | undefined;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    if (startInput.mode !== "runtime") {
      throw new Error(
        `${ServiceIds.CONTROL_PLANE_API} supports runtime mode in integration tests.`,
      );
    }

    const resolvedPostgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const resolvedSandboxBaseImage = startInput.infra.get(InfraIds.SANDBOX_BASE_IMAGE);
    const resolvedSeaweedfs = startInput.infra.get(InfraIds.SEAWEEDFS);
    const endpoint = httpEndpoint(startInput, ServiceIds.CONTROL_PLANE_API);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const runtime = await createControlPlaneApiRuntime({
      global: {
        env: "development",
      },
      app: config(
        input.googleAuth === undefined
          ? {
              controlPlaneBaseUrl: endpoint.hostBaseUrl,
              controlPlanePort: endpoint.port,
              dataPlaneBaseUrl: peer.url(ServiceIds.DATA_PLANE_API),
              gatewayWsUrl: withTestEnvironmentIdQueryParam({
                url: peer.ws(ServiceIds.DATA_PLANE_GATEWAY, "/tunnel/sandbox"),
                environmentId: startInput.environmentId,
              }),
              postgres: resolvedPostgres,
              sandboxBaseImageRef: readSandboxBaseImageRef({
                sandbox: input.sandbox,
                sandboxBaseImage: resolvedSandboxBaseImage,
              }),
              sandbox: input.sandbox,
              seaweedfs: resolvedSeaweedfs,
              ...(input.billingStripeEnabled === undefined
                ? {}
                : { billingStripeEnabled: input.billingStripeEnabled }),
              ...(input.allowSignups === undefined ? {} : { allowSignups: input.allowSignups }),
            }
          : {
              controlPlaneBaseUrl: endpoint.hostBaseUrl,
              controlPlanePort: endpoint.port,
              dataPlaneBaseUrl: peer.url(ServiceIds.DATA_PLANE_API),
              gatewayWsUrl: withTestEnvironmentIdQueryParam({
                url: peer.ws(ServiceIds.DATA_PLANE_GATEWAY, "/tunnel/sandbox"),
                environmentId: startInput.environmentId,
              }),
              postgres: resolvedPostgres,
              sandboxBaseImageRef: readSandboxBaseImageRef({
                sandbox: input.sandbox,
                sandboxBaseImage: resolvedSandboxBaseImage,
              }),
              sandbox: input.sandbox,
              seaweedfs: resolvedSeaweedfs,
              googleAuth: input.googleAuth,
              ...(input.billingStripeEnabled === undefined
                ? {}
                : { billingStripeEnabled: input.billingStripeEnabled }),
              ...(input.allowSignups === undefined ? {} : { allowSignups: input.allowSignups }),
            },
      ),
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

function withTestEnvironmentIdQueryParam(input: { url: string; environmentId: string }): string {
  const url = new URL(input.url);
  url.searchParams.set(TestEnvironmentIdHeader, input.environmentId);
  return url.toString();
}

function config(input: {
  controlPlaneBaseUrl: string;
  controlPlanePort: number;
  dataPlaneBaseUrl: string;
  gatewayWsUrl: string;
  postgres: ResolvedTestInfra;
  sandboxBaseImageRef: string | undefined;
  sandbox: IntegrationSandboxOptions | undefined;
  seaweedfs: ResolvedTestInfra | undefined;
  googleAuth?: "simulated";
  allowSignups?: boolean;
  billingStripeEnabled?: boolean;
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
      issuer: "integration-new-control-plane-api",
      audience: "integration-new-data-plane-gateway",
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
    ptyTransport: {
      tokenSecret: "integration-new-pty-token-secret",
      tokenIssuer: "integration-new-data-plane-gateway",
      tokenAudience: "integration-new-gateway-pty",
    },
    sandbox: {
      defaultBaseImage: input.sandboxBaseImageRef ?? getLocalDevDockerRegistrySandboxBaseImageRef(),
      gatewayWsUrl: input.gatewayWsUrl,
      docker: {
        enabled: input.sandbox?.provider !== "e2b",
      },
      ...(input.sandbox?.e2b === undefined ? {} : { e2b: mapE2BOptions(input.sandbox.e2b) }),
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
    billing: {
      stripe: {
        enabled: input.billingStripeEnabled ?? false,
      },
    },
    auth: {
      baseUrl: input.controlPlaneBaseUrl,
      secret: "integration-new-auth-secret",
      trustedOrigins: [input.controlPlaneBaseUrl],
      allowSignups: input.allowSignups ?? true,
      otpLength: 6,
      otpExpiresInSeconds: 300,
      otpAllowedAttempts: 3,
      ...(input.googleAuth === "simulated"
        ? {
            google: {
              clientId: "integration-new-google-client-id",
              clientSecret: "integration-new-google-client-secret",
            },
          }
        : {}),
    },
    commitSign: {
      binaryPath: CommitSignBinaryPath,
    },
    __dangerouslyEnableTestIsolation: {
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
      ...(input.googleAuth === "simulated"
        ? {
            googleAuth: {
              clientId: "integration-new-google-client-id",
              clientSecret: "integration-new-google-client-secret",
              verifyIdToken: async (token: string) =>
                readSimulatedGoogleIdToken(token).aud === "integration-new-google-client-id",
              getUserInfo: async (token) => {
                if (token.idToken === undefined) {
                  return null;
                }

                const profile = readSimulatedGoogleIdToken(token.idToken);

                return {
                  user: {
                    id: profile.sub,
                    name: profile.name ?? profile.email,
                    email: profile.email,
                    ...(profile.picture === undefined ? {} : { image: profile.picture }),
                    emailVerified: profile.email_verified,
                  },
                  data: profile,
                };
              },
            },
          }
        : {}),
    },
  };
}

function mapE2BOptions(input: NonNullable<IntegrationSandboxOptions["e2b"]>): {
  enabled: true;
  apiKey: string;
  domain: string;
} {
  return {
    enabled: true,
    apiKey: input.apiKey,
    domain: input.domain ?? DefaultE2BCloudDomain,
  };
}

function readSandboxBaseImageRef(input: {
  sandbox: IntegrationSandboxOptions | undefined;
  sandboxBaseImage: ResolvedTestInfra | undefined;
}): string | undefined {
  if (input.sandbox?.defaultBaseImageRef !== undefined) {
    return input.sandbox.defaultBaseImageRef;
  }

  if (input.sandboxBaseImage === undefined) {
    return undefined;
  }

  return infraValue(input.sandboxBaseImage, SandboxBaseImageValues.IMAGE_REF);
}

function readSimulatedGoogleIdToken(token: string): z.infer<typeof SimulatedGoogleIdTokenSchema> {
  const [, encodedPayload] = token.split(".");
  if (encodedPayload === undefined) {
    throw new Error("Expected simulated Google ID token to include a JWT payload.");
  }

  const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const profile = SimulatedGoogleIdTokenSchema.parse(parsed);
  if (profile.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Expected simulated Google ID token to be unexpired.");
  }

  return profile;
}
