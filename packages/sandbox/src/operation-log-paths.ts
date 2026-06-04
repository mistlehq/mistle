import { SandboxConfigurationError } from "./errors.js";
import type { SandboxRuntimeOperationLog } from "./types.js";

export const SandboxdOperationLogPaths: Record<SandboxRuntimeOperationLog, string> = {
  activate: "/run/mistle/activate.log",
  bootstrap_tunnel: "/run/mistle/bootstrap-tunnel.log",
};

export function resolveSandboxdOperationLogPath(operation: SandboxRuntimeOperationLog): string {
  switch (operation) {
    case "activate":
      return SandboxdOperationLogPaths.activate;
    case "bootstrap_tunnel":
      return SandboxdOperationLogPaths.bootstrap_tunnel;
    default:
      throw new SandboxConfigurationError(
        `Unsupported sandbox runtime operation log '${String(operation)}'.`,
      );
  }
}
