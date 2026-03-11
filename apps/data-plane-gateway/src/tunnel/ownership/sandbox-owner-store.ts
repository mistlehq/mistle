import type { SandboxOwner } from "./types.js";

export interface SandboxOwnerStore {
  claimOwner(input: {
    sandboxInstanceId: string;
    nodeId: string;
    sessionId: string;
    ttlMs: number;
  }): Promise<SandboxOwner>;
  renewOwnerLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
  }): Promise<boolean>;
  getOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwner | undefined>;
  releaseOwner(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean>;
}
