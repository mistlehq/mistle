import type { AgentExecutionObservation } from "@mistle/integrations-core";
import { AgentExecutionObservationTypes, AgentExecutionStates } from "@mistle/integrations-core";
import type { ExecutionLease } from "@mistle/sandbox-session-protocol";
import { systemSleeper, type Sleeper } from "@mistle/time";

import {
  ExecutionLeaseAlreadyTrackedError,
  ExecutionLeaseEngine,
} from "./execution-lease-engine.js";

const DefaultExecutionLeasePollIntervalMs = 10_000;

function isActiveObservation(
  observation: AgentExecutionObservation,
): observation is Extract<AgentExecutionObservation, { type: "active" }> {
  return observation.type === AgentExecutionObservationTypes.ACTIVE;
}

function toTunnelExecutionLease(
  observation: Extract<AgentExecutionObservation, { type: "active" }>,
): ExecutionLease {
  return {
    id: observation.lease.leaseId,
    kind: observation.lease.kind,
    source: observation.lease.source,
    externalExecutionId: observation.lease.externalExecutionId,
    ...(observation.lease.metadata === undefined ? {} : { metadata: observation.lease.metadata }),
  };
}

async function monitorObservedExecution(input: {
  signal: AbortSignal;
  executionLeases: ExecutionLeaseEngine;
  observation: AgentExecutionObservation;
  sleeper: Sleeper;
  pollIntervalMs: number;
}): Promise<void> {
  if (!isActiveObservation(input.observation)) {
    return;
  }

  let initialState: (typeof AgentExecutionStates)[keyof typeof AgentExecutionStates] | undefined;
  try {
    initialState = await input.observation.poll();
  } catch {
    initialState = undefined;
  }
  if (initialState !== undefined && initialState !== AgentExecutionStates.ACTIVE) {
    return;
  }

  const lease = toTunnelExecutionLease(input.observation);
  try {
    await input.executionLeases.create(lease);
  } catch (error) {
    if (error instanceof ExecutionLeaseAlreadyTrackedError) {
      return;
    }

    return;
  }

  try {
    while (!input.signal.aborted) {
      await input.sleeper.sleep(input.pollIntervalMs);
      if (input.signal.aborted) {
        return;
      }

      let executionState:
        | (typeof AgentExecutionStates)[keyof typeof AgentExecutionStates]
        | undefined;
      try {
        executionState = await input.observation.poll();
      } catch {
        executionState = undefined;
      }
      if (executionState === undefined) {
        continue;
      }
      if (executionState !== AgentExecutionStates.ACTIVE) {
        return;
      }

      try {
        await input.executionLeases.renew(lease.id);
      } catch {
        continue;
      }
    }
  } finally {
    input.executionLeases.remove(lease.id);
  }
}

export function trackObservedExecutions(input: {
  signal: AbortSignal;
  executionLeases: ExecutionLeaseEngine;
  observations: ReadonlyArray<AgentExecutionObservation>;
  sleeper?: Sleeper;
  pollIntervalMs?: number;
}): void {
  for (const observation of input.observations) {
    void monitorObservedExecution({
      signal: input.signal,
      executionLeases: input.executionLeases,
      observation,
      sleeper: input.sleeper ?? systemSleeper,
      pollIntervalMs: input.pollIntervalMs ?? DefaultExecutionLeasePollIntervalMs,
    });
  }
}
