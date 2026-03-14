import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { Clock, Sleeper } from "@mistle/time";

import type { TunnelReadinessPolicy, WaitForSandboxTunnelReadinessInput } from "./types.js";

export async function waitForSandboxTunnelReadiness(
  deps: {
    db: DataPlaneDatabase;
    policy: TunnelReadinessPolicy;
    clock: Clock;
    sleeper: Sleeper;
  },
  input: WaitForSandboxTunnelReadinessInput,
): Promise<boolean> {
  if (deps.policy.timeoutMs <= 0) {
    throw new Error("Expected sandbox tunnel readiness timeout to be positive.");
  }
  if (deps.policy.pollIntervalMs <= 0) {
    throw new Error("Expected sandbox tunnel readiness poll interval to be positive.");
  }
  if (input.bootstrapTokenJti.trim().length === 0) {
    throw new Error("Expected bootstrap token JTI to be non-empty when waiting for readiness.");
  }
  if (input.sandboxInstanceId.trim().length === 0) {
    throw new Error("Expected sandbox instance id to be non-empty when waiting for readiness.");
  }

  const deadlineMs = deps.clock.nowMs() + deps.policy.timeoutMs;
  while (true) {
    const [tokenRedemption, sandboxInstance] = await Promise.all([
      deps.db.query.sandboxTunnelTokenRedemptions.findFirst({
        columns: {
          tokenJti: true,
        },
        where: (table, { eq: whereEq }) => whereEq(table.tokenJti, input.bootstrapTokenJti),
      }),
      deps.db.query.sandboxInstances.findFirst({
        columns: {
          activeTunnelLeaseId: true,
          tunnelConnectedAt: true,
          lastTunnelSeenAt: true,
          tunnelDisconnectedAt: true,
        },
        where: (table, { eq: whereEq }) => whereEq(table.id, input.sandboxInstanceId),
      }),
    ]);

    if (
      tokenRedemption !== undefined &&
      sandboxInstance?.activeTunnelLeaseId !== null &&
      sandboxInstance?.activeTunnelLeaseId !== undefined &&
      sandboxInstance.tunnelConnectedAt !== null &&
      sandboxInstance.lastTunnelSeenAt !== null &&
      sandboxInstance.tunnelDisconnectedAt === null
    ) {
      return true;
    }

    const remainingMs = deadlineMs - deps.clock.nowMs();
    if (remainingMs <= 0) {
      return false;
    }
    await deps.sleeper.sleep(Math.min(remainingMs, deps.policy.pollIntervalMs));
  }
}
