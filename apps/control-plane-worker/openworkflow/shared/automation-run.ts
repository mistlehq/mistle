import {
  automationRuns,
  AutomationRunStatuses,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { MarkAutomationRunFailedInput } from "../../src/runtime/workflow-types.js";

type AutomationRunIdInput = {
  automationRunId: string;
};

type UpdateAutomationRunTerminalStateInput = {
  automationRunId: string;
  status: AutomationRunStatus;
  failureCode: string | null;
  failureMessage: string | null;
};

async function updateAutomationRunTerminalState(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: UpdateAutomationRunTerminalStateInput,
): Promise<void> {
  await ctx.db
    .update(automationRuns)
    .set({
      status: input.status,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationRuns.id, input.automationRunId),
        eq(automationRuns.status, AutomationRunStatuses.RUNNING),
      ),
    );
}

export async function markAutomationRunCompleted(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: AutomationRunIdInput,
): Promise<void> {
  await updateAutomationRunTerminalState(ctx, {
    automationRunId: input.automationRunId,
    status: AutomationRunStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
  });
}

export async function markAutomationRunFailed(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: MarkAutomationRunFailedInput,
): Promise<void> {
  await updateAutomationRunTerminalState(ctx, {
    automationRunId: input.automationRunId,
    status: AutomationRunStatuses.FAILED,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  });
}

export async function markAutomationRunIgnored(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: AutomationRunIdInput,
): Promise<void> {
  await updateAutomationRunTerminalState(ctx, {
    automationRunId: input.automationRunId,
    status: AutomationRunStatuses.IGNORED,
    failureCode: null,
    failureMessage: null,
  });
}
