import { createControlPlaneWorkerRuntime } from "../runtime/index.js";
import type { ControlPlaneWorkerRuntime, ControlPlaneWorkerRuntimeConfig } from "../types.js";

export type StartControlPlaneWorkerTestingRuntimeInput = {
  databaseDirectUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken?: string;
  smtp?: {
    host: string;
    port: number;
    secure?: boolean;
    username?: string;
    password?: string;
  };
  workflow?: {
    runMigrations?: boolean;
    concurrency?: number;
  };
  server?: {
    host?: string;
    port?: number;
  };
  email?: {
    fromAddress?: string;
    fromName?: string;
  };
  dataPlaneApi?: {
    baseUrl: string;
  };
};

function createTestingRuntimeConfig(
  input: StartControlPlaneWorkerTestingRuntimeInput,
): ControlPlaneWorkerRuntimeConfig {
  return {
    app: {
      server: {
        host: input.server?.host ?? "127.0.0.1",
        port: input.server?.port ?? 0,
      },
      workflow: {
        databaseUrl: input.databaseDirectUrl,
        namespaceId: input.workflowNamespaceId,
        runMigrations: input.workflow?.runMigrations ?? false,
        concurrency: input.workflow?.concurrency ?? 1,
      },
      email: {
        fromAddress: input.email?.fromAddress ?? "no-reply@mistle.dev",
        fromName: input.email?.fromName ?? "Mistle",
        smtpHost: input.smtp?.host ?? "127.0.0.1",
        smtpPort: input.smtp?.port ?? 2525,
        smtpSecure: input.smtp?.secure ?? false,
        smtpUsername: input.smtp?.username ?? "",
        smtpPassword: input.smtp?.password ?? "",
      },
      dataPlaneApi: {
        baseUrl: input.dataPlaneApi?.baseUrl ?? "http://127.0.0.1:65535",
      },
    },
    internalAuthServiceToken: input.internalAuthServiceToken ?? "integration-service-token",
  };
}

export async function startControlPlaneWorkerTestingRuntime(
  input: StartControlPlaneWorkerTestingRuntimeInput,
): Promise<ControlPlaneWorkerRuntime> {
  const runtime = await createControlPlaneWorkerRuntime(createTestingRuntimeConfig(input));
  await runtime.start();
  return runtime;
}

export type { ControlPlaneWorkerRuntime };
