export const SandboxProvider = {
  MODAL: "modal",
  DOCKER: "docker",
} as const;
export type SandboxProvider = (typeof SandboxProvider)[keyof typeof SandboxProvider];
export const SandboxRuntimeProvider = SandboxProvider;
export type SandboxRuntimeProvider = SandboxProvider;
export const SandboxVolumeProvider = SandboxProvider;
export type SandboxVolumeProvider = SandboxProvider;

export interface SandboxImageHandle {
  readonly provider: SandboxRuntimeProvider;
  readonly imageId: string;
  readonly createdAt: string;
}

export interface SandboxVolumeHandleV1 {
  readonly provider: SandboxVolumeProvider;
  readonly volumeId: string;
  readonly createdAt: string;
}

export interface SandboxHandle {
  readonly provider: SandboxRuntimeProvider;
  readonly runtimeId: string;
  writeStdin(input: { payload: Uint8Array<ArrayBufferLike> }): Promise<void>;
  closeStdin(): Promise<void>;
}

export interface SandboxVolumeMountV1 {
  readonly volume: SandboxVolumeHandleV1;
  readonly mountPath: string;
}

export interface SandboxStartRequest {
  readonly image: SandboxImageHandle;
  readonly mounts?: ReadonlyArray<SandboxVolumeMountV1>;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxResumeRequestV1 {
  readonly image: SandboxImageHandle;
  readonly mounts?: ReadonlyArray<SandboxVolumeMountV1>;
  readonly previousRuntimeId?: string | null;
  readonly env?: Readonly<Record<string, string>>;
}

export interface CreateVolumeRequestV1 {}

export interface DeleteVolumeRequestV1 {
  readonly volumeId: string;
}

export interface SandboxStopRequest {
  readonly runtimeId: string;
}

export interface SandboxDestroyRequest {
  readonly runtimeId: string;
}

export interface SandboxAdapter {
  createVolume(request: CreateVolumeRequestV1): Promise<SandboxVolumeHandleV1>;
  deleteVolume(request: DeleteVolumeRequestV1): Promise<void>;
  start(request: SandboxStartRequest): Promise<SandboxHandle>;
  resume(request: SandboxResumeRequestV1): Promise<SandboxHandle>;
  stop(request: SandboxStopRequest): Promise<void>;
  destroy(request: SandboxDestroyRequest): Promise<void>;
}
