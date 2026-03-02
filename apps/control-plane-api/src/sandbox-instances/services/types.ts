import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { BootstrapTokenConfig } from "@mistle/tunnel-auth";

export type CreateSandboxInstancesServiceInput = {
  dataPlaneDb: DataPlaneDatabase;
};

export type MintSandboxInstanceConnectionTokenInput = {
  organizationId: string;
  instanceId: string;
  gatewayWebsocketUrl: string;
  tokenTtlSeconds: number;
  tokenConfig: BootstrapTokenConfig;
};

export type SandboxInstanceConnectionToken = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type SandboxInstancesService = {
  mintConnectionToken: (
    input: MintSandboxInstanceConnectionTokenInput,
  ) => Promise<SandboxInstanceConnectionToken>;
};
