import type { SandboxInspectResult, SandboxProvider } from "../../types.js";

export type ModalSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.MODAL,
  "running" | "stopped",
  "active" | "terminal_stopped",
  {
    readonly reachable: boolean;
    readonly exitCode: number | null;
  }
>;
