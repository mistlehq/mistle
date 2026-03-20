import type { Clock, Sleeper } from "@mistle/time";

import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import { isSandboxRuntimeReady } from "../../runtime-state/sandbox-runtime-state-readiness.js";

export async function waitForSandboxTunnelReadiness(
  ctx: {
    runtimeStateReader: SandboxRuntimeStateReader;
    policy: {
      timeoutMs: number;
      pollIntervalMs: number;
    };
    clock: Clock;
    sleeper: Sleeper;
  },
  input: { sandboxInstanceId: string },
): Promise<boolean> {
  if (ctx.policy.timeoutMs <= 0) {
    throw new Error("Expected sandbox tunnel readiness timeout to be positive.");
  }
  if (ctx.policy.pollIntervalMs <= 0) {
    throw new Error("Expected sandbox tunnel readiness poll interval to be positive.");
  }
  if (input.sandboxInstanceId.trim().length === 0) {
    throw new Error("Expected sandbox instance id to be non-empty when waiting for readiness.");
  }

  const deadlineMs = ctx.clock.nowMs() + ctx.policy.timeoutMs;
  while (true) {
    const nowMs = ctx.clock.nowMs();
    const snapshot = await ctx.runtimeStateReader.readSnapshot({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs,
    });
    if (isSandboxRuntimeReady(snapshot)) {
      return true;
    }

    const remainingMs = deadlineMs - nowMs;
    if (remainingMs <= 0) {
      return false;
    }
    await ctx.sleeper.sleep(Math.min(remainingMs, ctx.policy.pollIntervalMs));
  }
}
