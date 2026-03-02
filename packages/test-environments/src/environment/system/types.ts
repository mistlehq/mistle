import type { ControlPlaneApiRuntime } from "@mistle/control-plane-api/testing";
import type { ControlPlaneWorkerRuntime } from "@mistle/control-plane-worker/testing";
import type { DataPlaneApiRuntime } from "@mistle/data-plane-api/testing";
import type {
  MailpitService,
  PostgresWithPgBouncerService,
  StartPostgresWithPgBouncerInput,
} from "@mistle/test-core";

export type StartSystemEnvironmentInput = {
  workflowNamespaceId?: string;
  internalAuthServiceToken?: string;
  controlPlanePostgres?: StartPostgresWithPgBouncerInput;
  dataPlanePostgres?: StartPostgresWithPgBouncerInput;
};

export type SystemEnvironment = {
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  controlPlaneBaseUrl: string;
  dataPlaneBaseUrl: string;
  controlPlaneDatabaseStack: PostgresWithPgBouncerService;
  dataPlaneDatabaseStack: PostgresWithPgBouncerService;
  mailpitService: MailpitService;
  controlPlaneApiRuntime: ControlPlaneApiRuntime;
  controlPlaneWorkerRuntime: ControlPlaneWorkerRuntime;
  dataPlaneApiRuntime: DataPlaneApiRuntime;
  requestControlPlane: (path: string, init?: RequestInit) => Promise<Response>;
  requestDataPlane: (path: string, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
};
