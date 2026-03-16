export const SandboxProvider = {
  MODAL: "modal",
  DOCKER: "docker",
} as const;
export type SandboxProvider = (typeof SandboxProvider)[keyof typeof SandboxProvider];

export interface SandboxImageHandle {
  readonly provider: SandboxProvider;
  readonly imageId: string;
  readonly createdAt: string;
}

export interface SandboxHandle {
  readonly provider: SandboxProvider;
  readonly sandboxId: string;
  writeStdin(input: { payload: Uint8Array<ArrayBufferLike> }): Promise<void>;
  closeStdin(): Promise<void>;
}

export interface SandboxStartRequest {
  readonly image: SandboxImageHandle;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxStopRequest {
  readonly sandboxId: string;
}

export interface SandboxAdapter {
  start(request: SandboxStartRequest): Promise<SandboxHandle>;
  stop(request: SandboxStopRequest): Promise<void>;
}
