import type {
  SandboxRuntimeAttachment,
  SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";

export type { SandboxRuntimeAttachment, SandboxRuntimeStateSnapshot };

/**
 * Reads the latest gateway-owned runtime-state snapshot for one sandbox.
 *
 * Data-plane API uses this to compose user-facing sandbox status from durable
 * lifecycle state plus live gateway attachment state.
 */
export interface SandboxRuntimeStateReader {
  /**
   * Returns the current owner/attachment snapshot for one sandbox.
   */
  readSnapshot(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeStateSnapshot>;
}
