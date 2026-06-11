import type { SandboxInspectResult, SandboxProvider } from "../../types.js";

export type OpenComputerRawSandboxInfo = {
  readonly sandboxID?: string | undefined;
  readonly sandboxId?: string | undefined;
  readonly id?: string | undefined;
  readonly status?: string | undefined;
  readonly createdAt?: string | null | undefined;
  readonly startedAt?: string | null | undefined;
  readonly updatedAt?: string | null | undefined;
  readonly endedAt?: string | null | undefined;
  readonly terminatedAt?: string | null | undefined;
};

export type OpenComputerSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.OPENCOMPUTER,
  SandboxInspectResult["state"],
  SandboxInspectResult["disposition"],
  OpenComputerRawSandboxInfo
>;

export type OpenComputerSnapshotInfo = {
  readonly name: string;
  readonly status: string;
  readonly manifest: unknown;
  readonly contentHash?: string;
  readonly checkpointId?: string;
};
