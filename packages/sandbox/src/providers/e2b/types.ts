import { SandboxInspectStates, SandboxProvider, type SandboxInspectResult } from "../../types.js";

export type E2BSandboxInspectState =
  | typeof SandboxInspectStates.RUNNING
  | typeof SandboxInspectStates.PAUSED;

export interface E2BSandboxInspectInfo {
  readonly templateId: string;
  readonly templateAlias: string;
  readonly name: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly cpuCount: number;
  readonly memoryMB: number;
}

export type E2BSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.E2B,
  E2BSandboxInspectState,
  E2BSandboxInspectInfo
>;
