export type SandboxOwner = {
  sandboxInstanceId: string;
  nodeId: string;
  sessionId: string;
  leaseId: string;
  expiresAt: Date;
};

export type SandboxOwnerResolution =
  | {
      kind: "missing";
    }
  | {
      kind: "local";
      owner: SandboxOwner;
    }
  | {
      kind: "remote";
      owner: SandboxOwner;
    };
