import type {
  AcquiredAutomationConnection,
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
  ResolvedAutomationConversationDeliveryRoute,
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
} from "@control-plane/workflows";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

export type StartSandboxProfileInstanceServiceDependencies = {
  db: ControlPlaneDatabase;
  dataPlaneSandboxInstancesClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
};

export type StartSandboxProfileInstanceServiceInput = StartSandboxProfileInstanceWorkflowInput;
export type StartSandboxProfileInstanceServiceOutput = StartSandboxProfileInstanceWorkflowOutput;

export type DeliverAutomationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
};

export type DeliverAutomationConversationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
};

export type ResolveResourceSyncCredentialInput = {
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type ResolveResourceSyncCredentialOutput = {
  value: string;
  expiresAt?: string;
};

export type ResolveResourceSyncTargetSecretsInput = {
  targetKey: string;
  encryptedSecrets: {
    ciphertext: string;
    nonce: string;
    masterKeyVersion: number;
  } | null;
};

export type ResolveResourceSyncTargetSecretsOutput = {
  secrets: Record<string, string>;
};

export type SyncIntegrationConnectionResourcesServiceDependencies = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  resolveIntegrationCredential?: (
    input: ResolveResourceSyncCredentialInput,
  ) => Promise<ResolveResourceSyncCredentialOutput>;
  resolveIntegrationTargetSecrets?: (
    input: ResolveResourceSyncTargetSecretsInput,
  ) => Promise<ResolveResourceSyncTargetSecretsOutput>;
};

export type SyncIntegrationConnectionResourcesServiceInput =
  SyncIntegrationConnectionResourcesWorkflowInput;
export type SyncIntegrationConnectionResourcesServiceOutput =
  SyncIntegrationConnectionResourcesWorkflowOutput;
