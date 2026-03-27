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
  CREATED: "created",
  RUNNING: "running",
  PAUSED: "paused",
  RESTARTING: "restarting",
  REMOVING: "removing",
  EXITED: "exited",
  DEAD: "dead",
  UNKNOWN: "unknown",
} as const;
export type SandboxInspectState = (typeof SandboxInspectStates)[keyof typeof SandboxInspectStates];
export type E2BSandboxInspectState =
  | typeof SandboxInspectStates.RUNNING
  | typeof SandboxInspectStates.PAUSED;

export interface SandboxInspectRequest {
  readonly id: string;
}

export interface DockerSandboxInspectResult {
  readonly provider: typeof SandboxProvider.DOCKER;
  readonly id: string;
  readonly state: SandboxInspectState;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly name: string;
  readonly imageRef: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly exitCode: number | null;
  readonly running: boolean;
  readonly paused: boolean;
  readonly restarting: boolean;
  readonly dead: boolean;
}

export interface E2BSandboxInspectResult {
  readonly provider: typeof SandboxProvider.E2B;
  readonly id: string;
  readonly state: E2BSandboxInspectState;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly endAt: string;
  readonly templateId: string;
  readonly templateAlias: string;
  readonly name: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly cpuCount: number;
  readonly memoryMB: number;
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
