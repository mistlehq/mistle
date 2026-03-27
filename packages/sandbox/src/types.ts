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
  PAUSED: "paused",
  STOPPED: "stopped",
  UNKNOWN: "unknown",
} as const;
export type SandboxInspectState = (typeof SandboxInspectStates)[keyof typeof SandboxInspectStates];
export type E2BSandboxInspectState =
  | typeof SandboxInspectStates.RUNNING
  | typeof SandboxInspectStates.PAUSED;

export interface SandboxInspectRequest {
  readonly id: string;
}

export interface DockerSandboxInspectInfo {
  readonly name: string;
  readonly imageRef: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly exitCode: number | null;
  readonly running: boolean;
  readonly paused: boolean;
  readonly restarting: boolean;
  readonly dead: boolean;
}

export interface E2BSandboxInspectInfo {
  readonly templateId: string;
  readonly templateAlias: string;
  readonly name: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly cpuCount: number;
  readonly memoryMB: number;
}

interface SandboxInspectResultBase<
  TProvider extends SandboxProvider,
  TState extends SandboxInspectState,
> {
  readonly provider: TProvider;
  readonly id: string;
  readonly state: TState;
  readonly createdAt: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

export interface DockerSandboxInspectResult extends SandboxInspectResultBase<
  typeof SandboxProvider.DOCKER,
  SandboxInspectState
> {
  readonly providerInfo: DockerSandboxInspectInfo;
}

export interface E2BSandboxInspectResult extends SandboxInspectResultBase<
  typeof SandboxProvider.E2B,
  E2BSandboxInspectState
> {
  readonly providerInfo: E2BSandboxInspectInfo;
}

export type SandboxInspectResult = DockerSandboxInspectResult | E2BSandboxInspectResult;

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
