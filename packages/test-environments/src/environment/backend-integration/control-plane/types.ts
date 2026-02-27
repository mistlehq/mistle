import type { ControlPlaneApiRuntime } from "@mistle/control-plane-api/testing";
import type { ControlPlaneWorkerRuntime } from "@mistle/control-plane-worker/testing";
import type {
  MailpitService,
  PostgresWithPgBouncerService,
  StartPostgresWithPgBouncerInput,
} from "@mistle/test-core";

import type { IntegrationCapability, IntegrationComponent } from "./capabilities.js";

export type StartIntegrationEnvironmentInput = {
  capabilities: readonly IntegrationCapability[];
  workflowNamespaceId?: string;
  postgres?: StartPostgresWithPgBouncerInput;
};

export type IntegrationEnvironment = {
  capabilities: readonly IntegrationCapability[];
  requiredComponents: readonly IntegrationComponent[];
  workflowNamespaceId: string;
  databaseStack: PostgresWithPgBouncerService;
  mailpitService: MailpitService | null;
  apiRuntime: ControlPlaneApiRuntime;
  workerRuntime: ControlPlaneWorkerRuntime | null;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
};
