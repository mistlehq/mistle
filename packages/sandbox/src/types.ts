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

export const SandboxStorageBackend = {
  ARCHIL: "archil",
  DOCKER_VOLUME: "docker_volume",
} as const;
export type SandboxStorageBackend =
  (typeof SandboxStorageBackend)[keyof typeof SandboxStorageBackend];

export interface SandboxStorageAttachmentBinding {
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface SandboxStorageAttachmentLayout {
  readonly bindings: readonly SandboxStorageAttachmentBinding[];
}

export const SandboxPersistentStorageLayout: SandboxStorageAttachmentLayout = {
  bindings: [
    {
      sourcePath: "root",
      targetPath: "/root",
    },
    {
      sourcePath: "etc/codex",
      targetPath: "/etc/codex",
    },
  ],
};

interface SandboxArchilStorageReference {
  readonly backend: typeof SandboxStorageBackend.ARCHIL;
  readonly handle: string;
  readonly region: string;
  readonly layout: SandboxStorageAttachmentLayout;
}

export interface SandboxArchilStorageAttachment extends SandboxArchilStorageReference {
  readonly credential: string;
}

export interface SandboxDockerVolumeStorageAttachment {
  readonly backend: typeof SandboxStorageBackend.DOCKER_VOLUME;
  readonly handle: string;
  readonly layout: SandboxStorageAttachmentLayout;
}

export interface SandboxDockerVolumeStartStoragePreparation extends SandboxDockerVolumeStorageAttachment {}

export type SandboxStartStoragePreparation =
  | Record<never, never>
  | SandboxDockerVolumeStartStoragePreparation;

export type SandboxStorageAttachment =
  | SandboxArchilStorageAttachment
  | SandboxDockerVolumeStorageAttachment;

export interface SandboxArchilStorageCleanup extends SandboxArchilStorageReference {}

export type SandboxStorageCleanup =
  | SandboxArchilStorageCleanup
  | SandboxDockerVolumeStorageAttachment;

export const SandboxStorageAttachLifecycles = {
  START: "start",
  RESUME: "resume",
} as const;
export type SandboxStorageAttachLifecycle =
  (typeof SandboxStorageAttachLifecycles)[keyof typeof SandboxStorageAttachLifecycles];

export const SandboxStorageCleanupLifecycles = {
  STOP: "stop",
  DESTROY: "destroy",
} as const;
export type SandboxStorageCleanupLifecycle =
  (typeof SandboxStorageCleanupLifecycles)[keyof typeof SandboxStorageCleanupLifecycles];

export const SandboxStorageCleanupTimings = {
  BEFORE_COMPUTE_TEARDOWN: "before_compute_teardown",
  AFTER_COMPUTE_TEARDOWN: "after_compute_teardown",
} as const;
export type SandboxStorageCleanupTiming =
  (typeof SandboxStorageCleanupTimings)[keyof typeof SandboxStorageCleanupTimings];

export interface SandboxAttachStorageRequest {
  readonly sandboxInstanceId: string;
  readonly sandbox: SandboxHandle;
  readonly lifecycle: SandboxStorageAttachLifecycle;
  readonly storage: SandboxStorageAttachment;
}

export interface SandboxCleanupStorageRequest {
  readonly sandboxInstanceId: string;
  readonly sandbox: SandboxHandle;
  readonly storage: SandboxStorageCleanup;
  readonly lifecycle: SandboxStorageCleanupLifecycle;
  readonly timing: SandboxStorageCleanupTiming;
}

export interface SandboxPrepareStorageForStartRequest {
  readonly sandboxInstanceId: string;
  readonly image: SandboxImageHandle;
  readonly storage?: SandboxStorageAttachment;
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
  init(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void>;
  resume(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void>;
  readOperationLog(input: { id: string; operation: "init" | "resume" }): Promise<string | null>;
  close(): Promise<void>;
}

export interface SandboxStartRequest {
  readonly image: SandboxImageHandle;
  readonly env?: Readonly<Record<string, string>>;
  readonly storagePreparation?: SandboxStartStoragePreparation;
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
  prepareStorageForStart(
    request: SandboxPrepareStorageForStartRequest,
  ): Promise<SandboxStartStoragePreparation>;
  start(request: SandboxStartRequest): Promise<SandboxHandle>;
  inspect(request: SandboxInspectRequest): Promise<SandboxInspectResult>;
  resume(request: SandboxResumeRequestV1): Promise<SandboxHandle>;
  attachStorage(request: SandboxAttachStorageRequest): Promise<void>;
  cleanupStorage(request: SandboxCleanupStorageRequest): Promise<void>;
  stop(request: SandboxStopRequest): Promise<void>;
  destroy(request: SandboxDestroyRequest): Promise<void>;
}
