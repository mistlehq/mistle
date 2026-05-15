import type { SandboxProvider } from "@mistle/sandbox";

export function assertRuntimeSandboxProvider(
  runtimeProvider: string,
): asserts runtimeProvider is SandboxProvider {
  if (
    runtimeProvider === "docker" ||
    runtimeProvider === "e2b" ||
    runtimeProvider === "tensorlake"
  ) {
    return;
  }

  throw new Error("Unsupported persisted sandbox provider.");
}
