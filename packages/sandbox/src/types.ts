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

export const SandboxInspectDispositions = {
  ACTIVE: "active",
  RESUMABLE_STOPPED: "resumable_stopped",
  TERMINAL_STOPPED: "terminal_stopped",
} as const;
export type SandboxInspectDisposition =
  (typeof SandboxInspectDispositions)[keyof typeof SandboxInspectDispositions];

export interface SandboxInspectRequest {
  readonly id: string;
}

export interface SandboxInspectResult<
  TProvider extends SandboxProvider = SandboxProvider,
  TState extends SandboxInspectState = SandboxInspectState,
  TDisposition extends SandboxInspectDisposition = SandboxInspectDisposition,
  TRaw = unknown,
> {
  readonly provider: TProvider;
  readonly id: string;
  readonly state: TState;
  /**
   * Provider-neutral lifecycle meaning for policy decisions.
   *
   * `state` intentionally stays coarse (`running` | `stopped`) so it can be shared
   * across providers. `disposition` carries the stronger semantic distinction that
   * data-plane lifecycle code actually needs:
   * - `active`: runtime still exists and is actively running
   * - `resumable_stopped`: runtime still exists and may be resumed
   * - `terminal_stopped`: runtime still exists but is terminal/dead
   */
  readonly disposition: TDisposition;
  readonly createdAt: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /**
   * Raw upstream provider payload for observability and provider-specific debugging.
   *
   * Application lifecycle code should prefer `state` and `disposition` over
   * branching on provider-specific raw fields.
   */
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
