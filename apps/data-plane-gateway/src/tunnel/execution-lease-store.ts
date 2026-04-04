import type { ExecutionLease } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import { ACTIVITY_LEASE_TTL_MS } from "../runtime-state/durations.js";
import type { SandboxKeepaliveStore } from "../runtime-state/sandbox-keepalive-store.js";

function assertSupportedExecutionLeaseKind(kind: string): void {
  if (kind === "agent_execution") {
    return;
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
  keepaliveStore: SandboxKeepaliveStore;
  clock: Clock;
  gatewayNodeId: string;
  lease: ExecutionLease;
  sandboxInstanceId: string;
}): Promise<void> {
  assertSupportedExecutionLeaseKind(input.lease.kind);

  await input.keepaliveStore.touchKeepalive({
    sandboxInstanceId: input.sandboxInstanceId,
    keepaliveId: input.lease.id,
    source: input.lease.source,
    ...(input.lease.externalExecutionId === undefined
      ? {}
      : { externalSubjectId: input.lease.externalExecutionId }),
    ...(input.lease.metadata === undefined ? {} : { metadata: input.lease.metadata }),
    nodeId: input.gatewayNodeId,
    ttlMs: ACTIVITY_LEASE_TTL_MS,
    nowMs: input.clock.nowMs(),
  });
}

export async function renewSandboxExecutionLease(input: {
  keepaliveStore: SandboxKeepaliveStore;
  clock: Clock;
  leaseId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const didRenew = await input.keepaliveStore.renewKeepalive({
    sandboxInstanceId: input.sandboxInstanceId,
    keepaliveId: input.leaseId,
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
