export const SandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
  TENSORLAKE: "tensorlake",
} as const;
export type SandboxProvider = (typeof SandboxProvider)[keyof typeof SandboxProvider];
export const SandboxRuntimeProvider = SandboxProvider;
export type SandboxRuntimeProvider = SandboxProvider;

export interface SandboxImageHandle {
  readonly provider: SandboxRuntimeProvider;
  /**
   * Provider-specific image/template identifier that can be passed back to the
   * same provider's `start({ image })` path.
   */
  readonly imageId: string;
  readonly createdAt: string;
}

export const SandboxBaseImageSourceKinds = {
  DOCKERFILE: "dockerfile",
  IMAGE: "image",
  SDK_IMAGE: "sdk_image",
} as const;
export type SandboxBaseImageSourceKind =
  (typeof SandboxBaseImageSourceKinds)[keyof typeof SandboxBaseImageSourceKinds];

export const SandboxBaseImagePublishModes = {
  LOAD: "load",
  PUSH: "push",
} as const;
export type SandboxBaseImagePublishMode =
  (typeof SandboxBaseImagePublishModes)[keyof typeof SandboxBaseImagePublishModes];

export interface SandboxDockerfileBaseImageSource {
  readonly kind: typeof SandboxBaseImageSourceKinds.DOCKERFILE;
  readonly additionalImageIds?: readonly string[];
  readonly contextPath: string;
  readonly dockerfilePath: string;
  readonly imageId: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly publishMode: SandboxBaseImagePublishMode;
  readonly target?: string;
}

export interface SandboxImageBaseImageSource {
  readonly kind: typeof SandboxBaseImageSourceKinds.IMAGE;
  readonly imageId: string;
}

export const SandboxSdkImageSandboxdSourceKinds = {
  LOCAL: "local",
  RELEASE: "release",
} as const;
export type SandboxSdkImageSandboxdSourceKind =
  (typeof SandboxSdkImageSandboxdSourceKinds)[keyof typeof SandboxSdkImageSandboxdSourceKinds];

export interface SandboxSdkImageLocalSandboxdSource {
  readonly kind: typeof SandboxSdkImageSandboxdSourceKinds.LOCAL;
}

export interface SandboxSdkImageReleaseSandboxdSource {
  readonly kind: typeof SandboxSdkImageSandboxdSourceKinds.RELEASE;
  readonly artifact: SandboxdArtifact;
}

export type SandboxSdkImageSandboxdSource =
  | SandboxSdkImageLocalSandboxdSource
  | SandboxSdkImageReleaseSandboxdSource;

export interface SandboxSdkImageBaseImageSource {
  readonly kind: typeof SandboxBaseImageSourceKinds.SDK_IMAGE;
  readonly baseImageRef: string;
  readonly contextPath: string;
  readonly imageId: string;
  readonly sandboxd?: SandboxSdkImageSandboxdSource;
}

export type SandboxBaseImageSource =
  | SandboxDockerfileBaseImageSource
  | SandboxImageBaseImageSource
  | SandboxSdkImageBaseImageSource;

export interface SandboxEnsureBaseImageRequest {
  readonly platform?: string;
  readonly source: SandboxBaseImageSource;
}

export interface SandboxBaseImageBuilder {
  ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle>;
}

export interface SandboxHandle {
  readonly provider: SandboxRuntimeProvider;
  readonly id: string;
}

export interface SandboxPrepareImageRequest {
  readonly image: SandboxImageHandle;
}

export const SandboxInspectStates = {
  RUNNING: "running",
  STOPPED: "stopped",
} as const;
export type SandboxInspectState = (typeof SandboxInspectStates)[keyof typeof SandboxInspectStates];

export const SandboxInspectDispositions = {
  ACTIVE: "active",
  STOPPING: "stopping",
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
   * - `stopping`: runtime still exists and provider stop/suspend is in progress
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

export interface SandboxRuntimeControlRequest {
  readonly id: string;
  readonly payload: Uint8Array<ArrayBufferLike>;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxdArtifact {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
}

export interface SandboxRuntimeEnsureSandboxdRequest {
  readonly id: string;
  readonly artifact: SandboxdArtifact;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxRuntimeControl {
  readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string>;
  ensureSandboxd(input: SandboxRuntimeEnsureSandboxdRequest): Promise<void>;
  activate(input: SandboxRuntimeControlRequest): Promise<void>;
  shutdown(input: { id: string; env?: Readonly<Record<string, string>> }): Promise<void>;
  readOperationLog(input: { id: string; operation: "activate" }): Promise<string | null>;
  close(): Promise<void>;
}

export const SandboxTransparentProxyBypassKinds = {
  SOCKET_MARK: "socket_mark",
} as const;
export type SandboxTransparentProxyBypassKind =
  (typeof SandboxTransparentProxyBypassKinds)[keyof typeof SandboxTransparentProxyBypassKinds];

export interface SandboxTransparentProxySocketMarkBypass {
  readonly kind: typeof SandboxTransparentProxyBypassKinds.SOCKET_MARK;
  readonly mark: number;
}

export type SandboxTransparentProxyBypass = SandboxTransparentProxySocketMarkBypass;

export const SandboxTransparentProxyExclusionKinds = {
  CIDR: "cidr",
  HOST: "host",
} as const;
export type SandboxTransparentProxyExclusionKind =
  (typeof SandboxTransparentProxyExclusionKinds)[keyof typeof SandboxTransparentProxyExclusionKinds];

export interface SandboxTransparentProxyCidrExclusion {
  readonly kind: typeof SandboxTransparentProxyExclusionKinds.CIDR;
  readonly value: string;
  readonly reason: string;
}

export interface SandboxTransparentProxyHostExclusion {
  readonly kind: typeof SandboxTransparentProxyExclusionKinds.HOST;
  readonly value: string;
  readonly reason: string;
}

export type SandboxTransparentProxyExclusion =
  | SandboxTransparentProxyCidrExclusion
  | SandboxTransparentProxyHostExclusion;

export interface SandboxTransparentProxyConfiguration {
  readonly provider: SandboxRuntimeProvider;
  readonly supported: boolean;
  readonly passthroughBypass: SandboxTransparentProxyBypass;
  readonly requiredLinuxCapabilities: readonly string[];
  readonly exclusions: readonly SandboxTransparentProxyExclusion[];
  readonly smokeRequirements: readonly string[];
}

export interface SandboxStartResources {
  readonly vcpuCount: number;
  readonly memoryMb: number;
  readonly diskMb?: number;
}

export interface SandboxStartRequest {
  readonly sandboxInstanceId?: string;
  readonly image: SandboxImageHandle;
  readonly env?: Readonly<Record<string, string>>;
  readonly resources?: SandboxStartResources;
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

export interface SandboxCaptureSnapshotRequest {
  readonly id: string;
  readonly providerRequestTimeoutMs?: number;
}

export interface SandboxAdapter {
  getTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration;
  prepareImage(request: SandboxPrepareImageRequest): Promise<SandboxImageHandle>;
  start(request: SandboxStartRequest): Promise<SandboxHandle>;
  inspect(request: SandboxInspectRequest): Promise<SandboxInspectResult>;
  resume(request: SandboxResumeRequestV1): Promise<SandboxHandle>;
  captureSnapshot(request: SandboxCaptureSnapshotRequest): Promise<SandboxImageHandle>;
  stop(request: SandboxStopRequest): Promise<void>;
  destroy(request: SandboxDestroyRequest): Promise<void>;
}
