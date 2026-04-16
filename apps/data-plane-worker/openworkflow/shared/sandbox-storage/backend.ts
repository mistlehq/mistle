import type {
  SandboxStorageAttachment,
  SandboxStorageBackend,
  SandboxStorageCleanup,
} from "@mistle/sandbox";

export interface SandboxStorageBackendRecord {
  readonly backend: SandboxStorageBackend;
  readonly handle: string;
  readonly status: "ready";
}

export interface SandboxStorageBackendAdapter {
  provision(input: {
    organizationId: string;
    sandboxInstanceId: string;
  }): Promise<SandboxStorageBackendRecord>;
  resolveAttachment(input: {
    organizationId: string;
    sandboxInstanceId: string;
  }): Promise<SandboxStorageAttachment>;
  resolveCleanup(input: { sandboxInstanceId: string }): Promise<SandboxStorageCleanup>;
  deprovision(input: { organizationId: string; sandboxInstanceId: string }): Promise<void>;
}
