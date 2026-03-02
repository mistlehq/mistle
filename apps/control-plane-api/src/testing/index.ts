import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { createControlPlaneBackend } from "@mistle/workflows/control-plane";

import { createControlPlaneApiRuntime } from "../runtime/index.js";
import type {
  ControlPlaneApiConfig,
  ControlPlaneApiRuntime,
  ControlPlaneApiRuntimeConfig,
} from "../types.js";

export type StartControlPlaneApiTestingRuntimeInput = {
  databaseDirectUrl: string;
  databasePooledUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken?: string;
  connectionToken?: {
    secret?: string;
    issuer?: string;
    audience?: string;
  };
  server?: {
    host?: string;
    port?: number;
  };
  dataPlaneApi?: {
    baseUrl?: string;
  };
  auth?: {
    baseUrl?: string;
    invitationAcceptBaseUrl?: string;
    trustedOrigins?: readonly string[];
    secret?: string;
    otpLength?: number;
    otpExpiresInSeconds?: number;
    otpAllowedAttempts?: number;
  };
  sandbox?: {
    defaultBaseImage?: string;
    gatewayWsUrl?: string;
  };
  integrations?: {
    activeMasterEncryptionKeyVersion?: number;
    masterEncryptionKeys?: Record<string, string>;
  };
};

function createTestingConfig(
  input: StartControlPlaneApiTestingRuntimeInput,
): ControlPlaneApiConfig {
  const serverHost = input.server?.host ?? "127.0.0.1";
  const serverPort = input.server?.port ?? 0;
  const authBaseUrl = input.auth?.baseUrl ?? `http://${serverHost}:${String(serverPort)}`;

  return {
    server: {
      host: serverHost,
      port: serverPort,
    },
    database: {
      url: input.databasePooledUrl,
    },
    workflow: {
      databaseUrl: input.databasePooledUrl,
      namespaceId: input.workflowNamespaceId,
    },
    dataPlaneApi: {
      baseUrl: input.dataPlaneApi?.baseUrl ?? "http://127.0.0.1:4000",
    },
    sandbox: {
      defaultBaseImage: input.sandbox?.defaultBaseImage ?? "127.0.0.1:5001/mistle/sandbox-base:dev",
      gatewayWsUrl: input.sandbox?.gatewayWsUrl ?? "ws://127.0.0.1:5202/tunnel/sandbox",
    },
    integrations: {
      activeMasterEncryptionKeyVersion: input.integrations?.activeMasterEncryptionKeyVersion ?? 1,
      masterEncryptionKeys: input.integrations?.masterEncryptionKeys ?? {
        "1": "integration-master-key-testing",
      },
    },
    auth: {
      baseUrl: authBaseUrl,
      invitationAcceptBaseUrl:
        input.auth?.invitationAcceptBaseUrl ?? "http://localhost:5173/invitations/accept",
      trustedOrigins: [...(input.auth?.trustedOrigins ?? [authBaseUrl])],
      secret: input.auth?.secret ?? "integration-auth-secret",
      otpLength: input.auth?.otpLength ?? 6,
      otpExpiresInSeconds: input.auth?.otpExpiresInSeconds ?? 300,
      otpAllowedAttempts: input.auth?.otpAllowedAttempts ?? 3,
    },
  };
}

async function runTestingBootstrap(input: {
  databaseDirectUrl: string;
  workflowNamespaceId: string;
}): Promise<void> {
  await runControlPlaneMigrations({
    connectionString: input.databaseDirectUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  const workflowBackend = await createControlPlaneBackend({
    url: input.databaseDirectUrl,
    namespaceId: input.workflowNamespaceId,
    runMigrations: true,
  });
  await workflowBackend.stop();
}

export async function startControlPlaneApiTestingRuntime(
  input: StartControlPlaneApiTestingRuntimeInput,
): Promise<ControlPlaneApiRuntime> {
  await runTestingBootstrap({
    databaseDirectUrl: input.databaseDirectUrl,
    workflowNamespaceId: input.workflowNamespaceId,
  });

  const runtimeConfig: ControlPlaneApiRuntimeConfig = {
    app: createTestingConfig(input),
    internalAuthServiceToken: input.internalAuthServiceToken ?? "integration-service-token",
    connectionToken: {
      secret: input.connectionToken?.secret ?? "integration-connection-secret",
      issuer: input.connectionToken?.issuer ?? "integration-issuer",
      audience: input.connectionToken?.audience ?? "integration-audience",
    },
  };

  return createControlPlaneApiRuntime(runtimeConfig);
}

export type { ControlPlaneApiRuntime };
