import type { ExecutionLease } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import { ACTIVITY_LEASE_TTL_MS } from "../runtime-state/durations.js";
import type { SandboxActivityStore } from "../runtime-state/sandbox-activity-store.js";

function toSandboxActivityLeaseKind(kind: string): "agent_execution" {
  if (kind === "agent_execution") {
    return kind;
  }

  throw new Error(`Unsupported execution lease kind '${kind}'.`);
}

export class SandboxExecutionLeaseNotFoundError extends Error {
  public constructor(input: { leaseId: string; sandboxInstanceId: string }) {
    super(
      `Execution lease '${input.leaseId}' was not found for sandbox '${input.sandboxInstanceId}'.`,
    );
    this.name = "SandboxExecutionLeaseNotFoundError";
  }
}

export async function createSandboxExecutionLease(input: {
  activityStore: SandboxActivityStore;
  clock: Clock;
  gatewayNodeId: string;
  lease: ExecutionLease;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.activityStore.touchLease({
    sandboxInstanceId: input.sandboxInstanceId,
    leaseId: input.lease.id,
    kind: toSandboxActivityLeaseKind(input.lease.kind),
    source: input.lease.source,
    ...(input.lease.externalExecutionId === undefined
      ? {}
      : { externalExecutionId: input.lease.externalExecutionId }),
    ...(input.lease.metadata === undefined ? {} : { metadata: input.lease.metadata }),
    nodeId: input.gatewayNodeId,
    ttlMs: ACTIVITY_LEASE_TTL_MS,
    nowMs: input.clock.nowMs(),
  });
}

export async function renewSandboxExecutionLease(input: {
  activityStore: SandboxActivityStore;
  clock: Clock;
  leaseId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const didRenew = await input.activityStore.renewLease({
    sandboxInstanceId: input.sandboxInstanceId,
    leaseId: input.leaseId,
    ttlMs: ACTIVITY_LEASE_TTL_MS,
    nowMs: input.clock.nowMs(),
  });

  if (didRenew) {
    return;
  }

  throw new SandboxExecutionLeaseNotFoundError({
    leaseId: input.leaseId,
    sandboxInstanceId: input.sandboxInstanceId,
  });
}
