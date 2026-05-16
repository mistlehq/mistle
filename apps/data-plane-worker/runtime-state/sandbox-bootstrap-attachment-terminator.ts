export type SandboxBootstrapAttachmentTerminateOutcome =
  | "terminated"
  | "closed"
  | "not_attached"
  | "fence_mismatch";

export const SandboxBootstrapAttachmentTerminateOutcomes: {
  TERMINATED: "terminated";
  CLOSED: "closed";
  NOT_ATTACHED: "not_attached";
  FENCE_MISMATCH: "fence_mismatch";
} = {
  TERMINATED: "terminated",
  CLOSED: "closed",
  NOT_ATTACHED: "not_attached",
  FENCE_MISMATCH: "fence_mismatch",
};

export type TerminateSandboxBootstrapAttachmentResult = {
  outcome: SandboxBootstrapAttachmentTerminateOutcome;
};

export interface SandboxBootstrapAttachmentTerminator {
  terminate(input: {
    sandboxInstanceId: string;
    expectedOwnerLeaseId: string;
    expectedSessionId: string;
  }): Promise<TerminateSandboxBootstrapAttachmentResult>;
}
