import type { Clock, Sleeper } from "@mistle/time";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../../runtime-state/sandbox-runtime-state-reader.js";

export function isSandboxBootstrapAttached(snapshot: SandboxRuntimeStateSnapshot): boolean {
  return (
    snapshot.ownerLeaseId !== null && snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId
  );
}

export async function waitForSandboxBootstrapAttachment(
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
    throw new Error("Expected sandbox bootstrap attachment timeout to be positive.");
  }
  if (ctx.policy.pollIntervalMs <= 0) {
    throw new Error("Expected sandbox bootstrap attachment poll interval to be positive.");
  }
  if (input.sandboxInstanceId.trim().length === 0) {
    throw new Error(
      "Expected sandbox instance id to be non-empty when waiting for bootstrap attachment.",
    );
  }

  const deadlineMs = ctx.clock.nowMs() + ctx.policy.timeoutMs;
  while (true) {
    const nowMs = ctx.clock.nowMs();
    const snapshot = await ctx.runtimeStateReader.readSnapshot({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs,
    });
    if (isSandboxBootstrapAttached(snapshot)) {
      return true;
    }

    const remainingMs = deadlineMs - nowMs;
    if (remainingMs <= 0) {
      return false;
    }
    await ctx.sleeper.sleep(Math.min(remainingMs, ctx.policy.pollIntervalMs));
  }
}
