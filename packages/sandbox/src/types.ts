export const SandboxProvider = {
  MODAL: "modal",
} as const;
export type SandboxProvider = (typeof SandboxProvider)[keyof typeof SandboxProvider];

export const SandboxImageKind = {
  BASE: "base",
  SNAPSHOT: "snapshot",
} as const;
export type SandboxImageKind = (typeof SandboxImageKind)[keyof typeof SandboxImageKind];

export interface SandboxImageHandle {
  readonly provider: SandboxProvider;
  readonly imageId: string;
  readonly kind: SandboxImageKind;
  readonly createdAt: string;
}

export interface SandboxHandle {
  readonly provider: SandboxProvider;
  readonly sandboxId: string;
}

export interface SandboxStartRequest {
  readonly image: SandboxImageHandle;
}

export interface SandboxSnapshotRequest {
  readonly sandboxId: string;
}

export interface SandboxStopRequest {
  readonly sandboxId: string;
}

export interface SandboxAdapter {
  start(request: SandboxStartRequest): Promise<SandboxHandle>;
  snapshot(request: SandboxSnapshotRequest): Promise<SandboxImageHandle>;
  stop(request: SandboxStopRequest): Promise<void>;
}
