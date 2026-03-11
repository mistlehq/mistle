import type { SandboxAdapter } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import type { StopSandboxInput } from "./types.js";

export async function stopSandbox(
  deps: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: StopSandboxInput,
): Promise<void> {
  if (input.provider !== deps.config.sandbox.provider) {
    throw new Error(
      "Attempted to stop sandbox using provider different from configured runtime sandbox provider.",
    );
  }

  await deps.sandboxAdapter.stop({
    sandboxId: input.providerSandboxId,
  });
}
