import type {
  SandboxRuntimeAttachment,
  SandboxRuntimeAttachmentStore,
} from "./sandbox-runtime-attachment-store.js";

export type ActiveBootstrapSession = SandboxRuntimeAttachment;

/**
 * Reads the authoritative active bootstrap session for a sandbox instance.
 */
export interface ActiveBootstrapSessionStore {
  getActiveSession(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<ActiveBootstrapSession | null>;
}

export function createAttachmentBackedActiveBootstrapSessionStore(
  sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore,
): ActiveBootstrapSessionStore {
  return {
    getActiveSession(input) {
      return sandboxRuntimeAttachmentStore.getAttachment(input);
    },
  };
}
