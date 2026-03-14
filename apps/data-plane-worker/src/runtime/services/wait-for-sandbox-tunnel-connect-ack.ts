import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { Clock, Sleeper } from "@mistle/time";

import type { TunnelConnectAckPolicy, WaitForSandboxTunnelConnectAckInput } from "./types.js";

export async function waitForSandboxTunnelConnectAck(
  deps: {
    db: DataPlaneDatabase;
    policy: TunnelConnectAckPolicy;
    clock: Clock;
    sleeper: Sleeper;
  },
  input: WaitForSandboxTunnelConnectAckInput,
): Promise<boolean> {
  if (deps.policy.timeoutMs <= 0) {
    throw new Error("Expected sandbox tunnel connect ack timeout to be positive.");
  }
  if (deps.policy.pollIntervalMs <= 0) {
    throw new Error("Expected sandbox tunnel connect ack poll interval to be positive.");
  }
  if (input.bootstrapTokenJti.trim().length === 0) {
    throw new Error("Expected bootstrap token JTI to be non-empty when waiting for connect ack.");
  }
  if (input.sandboxInstanceId.trim().length === 0) {
    throw new Error("Expected sandbox instance id to be non-empty when waiting for connect ack.");
  }

  const deadlineMs = deps.clock.nowMs() + deps.policy.timeoutMs;
  while (true) {
    const [ack, sandboxInstance] = await Promise.all([
      deps.db.query.sandboxTunnelConnectAcks.findFirst({
        columns: {
          bootstrapTokenJti: true,
        },
        where: (table, { eq: whereEq }) =>
          whereEq(table.bootstrapTokenJti, input.bootstrapTokenJti),
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
      ack !== undefined &&
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
