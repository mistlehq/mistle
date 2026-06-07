import type {
  SandboxInspectDisposition,
  SandboxInspectResult,
  SandboxInspectState,
  SandboxProvider,
} from "../../types.js";
import type { FreestyleVmState } from "./schemas.js";

export type FreestyleVmInfo = {
  readonly id: string;
  readonly name?: string | null;
  readonly state: FreestyleVmState;
  readonly createdAt?: string | null;
  readonly snapshotId?: string | null;
  readonly deleted?: boolean;
  readonly sizing: {
    readonly vcpuCount: number;
    readonly memSizeMib: number;
    readonly rootfsSizeMb: number;
  };
};

export type FreestyleSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.FREESTYLE,
  SandboxInspectState,
  SandboxInspectDisposition,
  FreestyleVmInfo
>;
