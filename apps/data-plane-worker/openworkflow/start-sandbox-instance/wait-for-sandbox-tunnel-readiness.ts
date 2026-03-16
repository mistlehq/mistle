import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { Clock, Sleeper } from "@mistle/time";

export async function waitForSandboxTunnelReadiness(
  ctx: {
    db: DataPlaneDatabase;
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
    const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
      columns: {
        activeTunnelLeaseId: true,
        tunnelConnectedAt: true,
        lastTunnelSeenAt: true,
        tunnelDisconnectedAt: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, input.sandboxInstanceId),
    });

    if (
      sandboxInstance?.activeTunnelLeaseId !== null &&
      sandboxInstance?.activeTunnelLeaseId !== undefined &&
      sandboxInstance.tunnelConnectedAt !== null &&
      sandboxInstance.lastTunnelSeenAt !== null &&
      sandboxInstance.tunnelDisconnectedAt === null
    ) {
      return true;
    }

    const remainingMs = deadlineMs - ctx.clock.nowMs();
    if (remainingMs <= 0) {
      return false;
    }
    await ctx.sleeper.sleep(Math.min(remainingMs, ctx.policy.pollIntervalMs));
  }
}
