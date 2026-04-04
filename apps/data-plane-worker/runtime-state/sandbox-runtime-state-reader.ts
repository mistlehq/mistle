import type {
  SandboxRuntimeAttachment,
  SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";

export type { SandboxRuntimeAttachment, SandboxRuntimeStateSnapshot };

/**
 * Reads worker-visible runtime state regardless of the backing implementation.
 *
 * Worker callers should not branch on the gateway's runtime-state storage
 * backend. The current implementation reads through an internal gateway HTTP
 * route, and later gateway-side backends may change without affecting worker
 * call sites. Snapshots include owner/attachment state plus presence and
 * keepalive summaries.
 */
export interface SandboxRuntimeStateReader {
  /**
   * Reads the latest runtime-state snapshot for the sandbox instance.
   */
  readSnapshot(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeStateSnapshot>;
}
