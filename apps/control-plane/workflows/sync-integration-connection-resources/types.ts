import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import type {
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
} from "./workflow.js";

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
