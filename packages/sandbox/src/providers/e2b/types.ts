import {
  SandboxProvider,
  type SandboxInspectResult,
  type SandboxInspectState,
} from "../../types.js";

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
  SandboxInspectState,
  E2BSandboxInspectInfo
>;
