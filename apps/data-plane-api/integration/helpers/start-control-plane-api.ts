import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { SandboxStorageBackend } from "@mistle/sandbox";
import { shutdownTelemetry } from "@mistle/telemetry";
import { z } from "zod";

import { createControlPlaneApiRuntime } from "../../../control-plane-api/src/main.js";

const EnvironmentSchema = z
  .object({
    MISTLE_TEST_CONTROL_PLANE_API_HOST: z.string().min(1),
    MISTLE_TEST_CONTROL_PLANE_API_PORT: z.coerce.number().int().min(1).max(65_535),
    MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL: z.string().min(1),
    MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: z.string().min(1),
    MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: z.string().min(1),
    MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN: z.string().min(1),
    MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND: z.enum([
      SandboxStorageBackend.ARCHIL,
      SandboxStorageBackend.DOCKER_VOLUME,
    ]),
  })
  .strict();

function readEnvironment(): z.infer<typeof EnvironmentSchema> {
  return EnvironmentSchema.parse({
    MISTLE_TEST_CONTROL_PLANE_API_HOST: process.env.MISTLE_TEST_CONTROL_PLANE_API_HOST,
    MISTLE_TEST_CONTROL_PLANE_API_PORT: process.env.MISTLE_TEST_CONTROL_PLANE_API_PORT,
    MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL:
      process.env.MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL,
    MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL:
      process.env.MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL,
    MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID:
      process.env.MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID,
    MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN:
      process.env.MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN,
    MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND:
      process.env.MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND,
  });
}

function buildControlPlaneBaseUrl(input: { host: string; port: number }): string {
  return `http://${input.host}:${String(input.port)}`;
}

async function main(): Promise<void> {
  const env = readEnvironment();
  const controlPlaneBaseUrl = buildControlPlaneBaseUrl({
    host: env.MISTLE_TEST_CONTROL_PLANE_API_HOST,
    port: env.MISTLE_TEST_CONTROL_PLANE_API_PORT,
  });
  const runtime = await createControlPlaneApiRuntime({
    app: {
      server: {
        host: env.MISTLE_TEST_CONTROL_PLANE_API_HOST,
        port: env.MISTLE_TEST_CONTROL_PLANE_API_PORT,
      },
      database: {
        url: env.MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL,
        migrationUrl: env.MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL,
      },
      objectStore: {
        bucketName: "integration-media",
        region: "us-east-1",
        endpoint: "http://127.0.0.1:8333",
        forcePathStyle: true,
        accessKeyId: "integration-access-key",
        secretAccessKey: "integration-secret-key",
      },
      workflow: {
        databaseUrl: env.MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL,
        migrationUrl: env.MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL,
        namespaceId: env.MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID,
      },
      dataPlaneApi: {
        baseUrl: env.MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL,
      },
      internalAuth: {
        serviceToken: env.MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN,
      },
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: {
        baseDomain: "sandbox.local",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        access: {
          tokenSecret: "integration-port-access-secret",
          tokenIssuer: "integration-port-access-issuer",
          tokenAudience: "integration-port-access-audience",
        },
      },
      sandbox: {
        defaultBaseImage: getLocalDevDockerRegistrySandboxBaseImageRef(),
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        bootstrap: {
          tokenSecret: "integration-bootstrap-token-secret",
          tokenIssuer: "integration-data-plane-worker",
          tokenAudience: "integration-data-plane-gateway",
        },
        storageBackend: env.MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND,
      },
      integrations: {
        activeMasterEncryptionKeyVersion: 1,
        masterEncryptionKeys: {
          "1": "integration-master-key-testing",
        },
      },
      dashboard: {
        baseUrl: "http://localhost:5173",
      },
      auth: {
        baseUrl: controlPlaneBaseUrl,
        secret: "integration-auth-secret",
        trustedOrigins: [controlPlaneBaseUrl],
        otpLength: 6,
        otpExpiresInSeconds: 300,
        otpAllowedAttempts: 3,
      },
      ...(process.env.MISTLE_TEST_COMMIT_SIGN_BINARY_PATH === undefined
        ? {}
        : {
            commitSign: {
              binaryPath: process.env.MISTLE_TEST_COMMIT_SIGN_BINARY_PATH,
            },
          }),
    },
  });

  await runtime.start();

  let shutdownPromise: Promise<void> | undefined;

  async function stopRuntimeAndExit(signal: NodeJS.Signals): Promise<void> {
    try {
      await runtime.stop();
      await shutdownTelemetry();
      process.exit(0);
    } catch (error) {
      console.error("Failed to gracefully shutdown integration control-plane-api", {
        signal,
        error,
      });
      await shutdownTelemetry();
      process.exit(1);
    }
  }

  async function shutdownAndExit(signal: NodeJS.Signals): Promise<void> {
    if (shutdownPromise !== undefined) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = stopRuntimeAndExit(signal);

    await shutdownPromise;
  }

  process.once("SIGINT", () => {
    void shutdownAndExit("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdownAndExit("SIGTERM");
  });
}

void main().catch(async (error) => {
  console.error("Failed to start integration control-plane-api", error);
  await shutdownTelemetry();
  process.exit(1);
});
