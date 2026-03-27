export const SandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;
export type SandboxProvider = (typeof SandboxProvider)[keyof typeof SandboxProvider];
export const SandboxRuntimeProvider = SandboxProvider;
export type SandboxRuntimeProvider = SandboxProvider;

export interface SandboxImageHandle {
  readonly provider: SandboxRuntimeProvider;
  readonly imageId: string;
  readonly createdAt: string;
}

export interface SandboxHandle {
  readonly provider: SandboxRuntimeProvider;
  readonly id: string;
}

export const SandboxInspectStates = {
  RUNNING: "running",
  STOPPED: "stopped",
} as const;
export type SandboxInspectState = (typeof SandboxInspectStates)[keyof typeof SandboxInspectStates];

export interface SandboxInspectRequest {
  readonly id: string;
}

export interface SandboxInspectResult<
  TProvider extends SandboxProvider = SandboxProvider,
  TState extends SandboxInspectState = SandboxInspectState,
  TRaw = unknown,
> {
  readonly provider: TProvider;
  readonly id: string;
  readonly state: TState;
  readonly createdAt: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly raw: TRaw;
}

export interface SandboxRuntimeControl {
  applyStartup(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void>;
  close(): Promise<void>;
}

export interface SandboxStartRequest {
  readonly image: SandboxImageHandle;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxResumeRequestV1 {
  readonly id: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxStopRequest {
  readonly id: string;
}

export interface SandboxDestroyRequest {
  readonly id: string;
}

export interface SandboxAdapter {
  start(request: SandboxStartRequest): Promise<SandboxHandle>;
  inspect(request: SandboxInspectRequest): Promise<SandboxInspectResult>;
  resume(request: SandboxResumeRequestV1): Promise<SandboxHandle>;
  stop(request: SandboxStopRequest): Promise<void>;
  destroy(request: SandboxDestroyRequest): Promise<void>;
}
