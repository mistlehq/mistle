import type { ControlPlaneWorkerConfig, ControlPlaneWorkerRuntime } from "../types.js";

import { createControlPlaneWorkerRuntime } from "../runtime/index.js";

export type StartControlPlaneWorkerTestingRuntimeInput = {
  databaseDirectUrl: string;
  workflowNamespaceId: string;
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
};

function createTestingConfig(
  input: StartControlPlaneWorkerTestingRuntimeInput,
): ControlPlaneWorkerConfig {
  return {
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
  };
}

export async function startControlPlaneWorkerTestingRuntime(
  input: StartControlPlaneWorkerTestingRuntimeInput,
): Promise<ControlPlaneWorkerRuntime> {
  const runtime = await createControlPlaneWorkerRuntime(createTestingConfig(input));
  await runtime.start();
  return runtime;
}

export type { ControlPlaneWorkerRuntime };
