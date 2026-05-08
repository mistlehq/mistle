import type { ServiceId } from "./service-ids.js";

export type IntegrationSandboxProvider = "docker" | "e2b";

export type IntegrationSandboxE2BOptions = {
  apiKey: string;
  domain?: string;
  cpuCount?: string;
  memoryMb?: string;
  templateLockDirectoryPath?: string;
};

export type IntegrationSandboxOptions = {
  provider: IntegrationSandboxProvider;
  defaultBaseImageRef?: string;
  e2b?: IntegrationSandboxE2BOptions;
  publicServiceBaseUrls?: ReadonlyMap<ServiceId, string>;
};

export type IntegrationServiceOptions = {
  controlPlaneApi: {
    googleAuth?: "simulated";
  };
  sandbox?: IntegrationSandboxOptions;
};
