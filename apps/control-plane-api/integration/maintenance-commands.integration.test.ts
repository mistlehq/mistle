/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationDeviceAuthorizationAttemptStatuses } from "@mistle/db/control-plane";
import {
  SandboxInstanceProviders,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  SandboxInstanceStatuses,
  SandboxOperationEventRecordKinds,
  SandboxOperationEventSources,
  SandboxOperationKinds,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import type { Clock } from "@mistle/time";
import { describe, expect } from "vitest";

import { pruneExpiredAuthState } from "../src/maintenance/commands/prune-expired-auth-state.js";
import { pruneExpiredIntegrationAuthState } from "../src/maintenance/commands/prune-expired-integration-auth-state.js";
import { pruneSandboxOperationEvents } from "../src/maintenance/commands/prune-sandbox-operation-events.js";

const FixedNowMs = Date.UTC(2026, 3, 29, 0, 0, 0);
const FixedClock: Clock = {
  nowMs: () => FixedNowMs,
  nowDate: () => new Date(FixedNowMs),
};

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("maintenance commands", () => {
  it("prunes expired auth state after the retention grace", async ({ env }) => {
    const user = await seedUser(env, "auth-state");
    const oldVerificationId = "vrf_maintenance_new_old";
    const recentVerificationId = "vrf_maintenance_new_recent";
    const futureVerificationId = "vrf_maintenance_new_future";
    const oldSessionId = "ses_maintenance_new_old";
    const recentSessionId = "ses_maintenance_new_recent";
    const futureSessionId = "ses_maintenance_new_future";

    await env.controlPlaneDb.insert(env.controlPlaneTables.verifications).values([
      {
        id: oldVerificationId,
        identifier: "old@example.com",
        value: "111111",
        expiresAt: new Date(FixedNowMs - hours(25)),
      },
      {
        id: recentVerificationId,
        identifier: "recent@example.com",
        value: "222222",
        expiresAt: new Date(FixedNowMs - hours(23)),
      },
      {
        id: futureVerificationId,
        identifier: "future@example.com",
        value: "333333",
        expiresAt: new Date(FixedNowMs + hours(1)),
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.sessions).values([
      {
        id: oldSessionId,
        userId: user.id,
        token: "maintenance-new-old-session",
        expiresAt: new Date(FixedNowMs - hours(25)),
      },
      {
        id: recentSessionId,
        userId: user.id,
        token: "maintenance-new-recent-session",
        expiresAt: new Date(FixedNowMs - hours(23)),
      },
      {
        id: futureSessionId,
        userId: user.id,
        token: "maintenance-new-future-session",
        expiresAt: new Date(FixedNowMs + hours(1)),
      },
    ]);

    await expect(
      pruneExpiredAuthState({
        db: env.controlPlaneDb,
        clock: FixedClock,
      }),
    ).resolves.toEqual({
      deletedRowCounts: {
        verifications: 1,
        sessions: 1,
      },
      reachedMaxBatches: false,
    });

    await expectExistingIds({
      env,
      table: "verifications",
      ids: [oldVerificationId, recentVerificationId, futureVerificationId],
      expectedIds: [recentVerificationId, futureVerificationId],
    });
    await expectExistingIds({
      env,
      table: "sessions",
      ids: [oldSessionId, recentSessionId, futureSessionId],
      expectedIds: [recentSessionId, futureSessionId],
    });
  });

  it("prunes expired integration auth state after command-specific retention", async ({ env }) => {
    const graph = await seedIntegrationAuthGraph(env, "integration-auth-state");
    const oldConnectionRedirectSessionId = "ios_maintenance_new_old";
    const recentConnectionRedirectSessionId = "ios_maintenance_new_recent";
    const oldIdentityLinkRedirectSessionId = "ilr_maintenance_new_old";
    const recentIdentityLinkRedirectSessionId = "ilr_maintenance_new_recent";
    const oldTerminalAttemptId = "ida_maintenance_new_terminal_old";
    const recentTerminalAttemptId = "ida_maintenance_new_terminal_recent";
    const oldPendingAttemptId = "ida_maintenance_new_pending_old";
    const recentPendingAttemptId = "ida_maintenance_new_pending_recent";
    const pendingWithoutExpiryAttemptId = "ida_maintenance_new_pending_no_expiry";

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionRedirectSessions)
      .values([
        {
          id: oldConnectionRedirectSessionId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          state: "maintenance-connection-old",
          expiresAt: iso(FixedNowMs - hours(25)),
        },
        {
          id: recentConnectionRedirectSessionId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          state: "maintenance-connection-recent",
          expiresAt: iso(FixedNowMs - hours(23)),
        },
      ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.identityLinkRedirectSessions).values([
      {
        id: oldIdentityLinkRedirectSessionId,
        organizationId: graph.organizationId,
        userId: graph.userId,
        providerFamily: graph.providerFamily,
        organizationProviderConfigId: graph.providerConfigId,
        integrationConnectionId: graph.integrationConnectionId,
        state: "maintenance-identity-old",
        expiresAt: iso(FixedNowMs - hours(25)),
      },
      {
        id: recentIdentityLinkRedirectSessionId,
        organizationId: graph.organizationId,
        userId: graph.userId,
        providerFamily: graph.providerFamily,
        organizationProviderConfigId: graph.providerConfigId,
        integrationConnectionId: graph.integrationConnectionId,
        state: "maintenance-identity-recent",
        expiresAt: iso(FixedNowMs - hours(23)),
      },
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionDeviceAuthorizationAttempts)
      .values([
        {
          id: oldTerminalAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "OLDTERM",
          updatedAt: iso(FixedNowMs - days(31)),
          completedAt: iso(FixedNowMs - days(31)),
        },
        {
          id: recentTerminalAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "NEWTERM",
          updatedAt: iso(FixedNowMs - days(29)),
        },
        {
          id: oldPendingAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "OLDPEND",
          expiresAt: iso(FixedNowMs - hours(25)),
        },
        {
          id: recentPendingAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "NEWPEND",
          expiresAt: iso(FixedNowMs - hours(23)),
        },
        {
          id: pendingWithoutExpiryAttemptId,
          organizationId: graph.organizationId,
          targetKey: graph.targetKey,
          connectionMethodId: "device",
          status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
          providerStateEncrypted: "provider-state",
          verificationUrl: "https://example.com/device",
          userCode: "NOEXPIR",
        },
      ]);

    await expect(
      pruneExpiredIntegrationAuthState({
        db: env.controlPlaneDb,
        clock: FixedClock,
      }),
    ).resolves.toEqual({
      deletedRowCounts: {
        integration_connection_redirect_sessions: 1,
        identity_link_redirect_sessions: 1,
        integration_connection_device_authorization_attempts_terminal: 1,
        integration_connection_device_authorization_attempts_pending_expired: 1,
      },
      reachedMaxBatches: false,
    });

    await expectExistingIds({
      env,
      table: "integrationConnectionRedirectSessions",
      ids: [oldConnectionRedirectSessionId, recentConnectionRedirectSessionId],
      expectedIds: [recentConnectionRedirectSessionId],
    });
    await expectExistingIds({
      env,
      table: "identityLinkRedirectSessions",
      ids: [oldIdentityLinkRedirectSessionId, recentIdentityLinkRedirectSessionId],
      expectedIds: [recentIdentityLinkRedirectSessionId],
    });
    await expectExistingIds({
      env,
      table: "integrationConnectionDeviceAuthorizationAttempts",
      ids: [
        oldTerminalAttemptId,
        recentTerminalAttemptId,
        oldPendingAttemptId,
        recentPendingAttemptId,
        pendingWithoutExpiryAttemptId,
      ],
      expectedIds: [recentTerminalAttemptId, recentPendingAttemptId, pendingWithoutExpiryAttemptId],
    });
  });

  it("prunes old sandbox operation events regardless of sandbox lifecycle status", async ({
    env,
  }) => {
    const oldStoppedSandboxId = "sbi_maintenance_events_old_stopped";
    const oldFailedSandboxId = "sbi_maintenance_events_old_failed";
    const oldRunningSandboxId = "sbi_maintenance_events_old_running";
    const recentStoppedSandboxId = "sbi_maintenance_events_recent_stopped";
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values([
      sandboxInstanceRow({
        id: oldStoppedSandboxId,
        status: SandboxInstanceStatuses.STOPPED,
      }),
      sandboxInstanceRow({
        id: oldFailedSandboxId,
        status: SandboxInstanceStatuses.FAILED,
      }),
      sandboxInstanceRow({
        id: oldRunningSandboxId,
        status: SandboxInstanceStatuses.RUNNING,
      }),
      sandboxInstanceRow({
        id: recentStoppedSandboxId,
        status: SandboxInstanceStatuses.STOPPED,
      }),
    ]);

    const oldStoppedEventIds = Array.from(
      { length: 501 },
      (_, index) => `soe_maintenance_events_old_stopped_${String(index).padStart(3, "0")}`,
    );
    const oldStoppedEvents = oldStoppedEventIds.map((id, index) =>
      sandboxOperationEventRow({
        id,
        sandboxInstanceId: oldStoppedSandboxId,
        sequence: index + 1,
        createdAt: iso(FixedNowMs - days(15)),
        observedAt: iso(FixedNowMs - days(15)),
      }),
    );
    const oldFailedEventId = "soe_maintenance_events_old_failed";
    const oldRunningEventId = "soe_maintenance_events_old_running";
    const recentStoppedEventId = "soe_maintenance_events_recent_stopped";
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
      ...oldStoppedEvents,
      sandboxOperationEventRow({
        id: oldFailedEventId,
        sandboxInstanceId: oldFailedSandboxId,
        sequence: 1,
        createdAt: iso(FixedNowMs - days(15)),
        observedAt: iso(FixedNowMs - days(15)),
      }),
      sandboxOperationEventRow({
        id: oldRunningEventId,
        sandboxInstanceId: oldRunningSandboxId,
        sequence: 1,
        createdAt: iso(FixedNowMs - days(15)),
        observedAt: iso(FixedNowMs - days(15)),
      }),
      sandboxOperationEventRow({
        id: recentStoppedEventId,
        sandboxInstanceId: recentStoppedSandboxId,
        sequence: 1,
        createdAt: iso(FixedNowMs - days(13)),
        observedAt: iso(FixedNowMs - days(13)),
      }),
    ]);

    await expect(
      pruneSandboxOperationEvents({
        db: env.dataPlaneDb,
        clock: FixedClock,
      }),
    ).resolves.toEqual({
      deletedRowCounts: {
        sandbox_operation_events: 503,
      },
      reachedMaxBatches: false,
    });

    await expectExistingSandboxOperationEventIds({
      env,
      ids: [...oldStoppedEventIds, oldFailedEventId, oldRunningEventId, recentStoppedEventId],
      expectedIds: [recentStoppedEventId],
    });
  });
});

async function seedUser(env: IntegrationTestEnvironment, label: string): Promise<{ id: string }> {
  const id = `usr_maintenance_new_${label.replaceAll("-", "_")}`;
  await env.controlPlaneDb.insert(env.controlPlaneTables.users).values({
    id,
    name: `Maintenance ${label}`,
    email: `${label}@maintenance-new.example.com`,
  });

  return { id };
}

async function seedIntegrationAuthGraph(
  env: IntegrationTestEnvironment,
  label: string,
): Promise<{
  organizationId: string;
  userId: string;
  targetKey: string;
  providerFamily: string;
  integrationConnectionId: string;
  providerConfigId: string;
}> {
  const normalizedLabel = label.replaceAll("-", "_");
  const organizationId = `org_maintenance_new_${normalizedLabel}`;
  const userId = `usr_maintenance_new_${normalizedLabel}`;
  const targetKey = `maintenance-new-${label}`;
  const providerFamily = `maintenance-new-${label}`;
  const integrationConnectionId = `icn_maintenance_new_${normalizedLabel}`;
  const providerConfigId = `ilp_maintenance_new_${normalizedLabel}`;

  await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Maintenance ${label}`,
    slug: `maintenance-new-${label}`,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.users).values({
    id: userId,
    name: `Maintenance ${label}`,
    email: `${label}@maintenance-new.example.com`,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: providerFamily,
    variantId: "default",
    enabled: true,
    config: {},
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: integrationConnectionId,
    organizationId,
    targetKey,
    displayName: `Maintenance ${label}`,
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
    .values({
      id: providerConfigId,
      organizationId,
      providerFamily,
      integrationTargetKey: targetKey,
      integrationConnectionId,
      createdByUserId: userId,
      updatedByUserId: userId,
    });

  return {
    organizationId,
    userId,
    targetKey,
    providerFamily,
    integrationConnectionId,
    providerConfigId,
  };
}

async function expectExistingIds(input: {
  env: IntegrationTestEnvironment;
  table:
    | "identityLinkRedirectSessions"
    | "integrationConnectionDeviceAuthorizationAttempts"
    | "integrationConnectionRedirectSessions"
    | "sessions"
    | "verifications";
  ids: string[];
  expectedIds: string[];
}): Promise<void> {
  const rows = await selectExistingIds(input);
  expect(rows.map((row) => row.id).sort()).toEqual(input.expectedIds.toSorted());
}

async function selectExistingIds(input: {
  env: IntegrationTestEnvironment;
  table:
    | "identityLinkRedirectSessions"
    | "integrationConnectionDeviceAuthorizationAttempts"
    | "integrationConnectionRedirectSessions"
    | "sessions"
    | "verifications";
  ids: string[];
}): Promise<Array<{ id: string }>> {
  if (input.table === "verifications") {
    return input.env.controlPlaneDb.query.verifications.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }
  if (input.table === "sessions") {
    return input.env.controlPlaneDb.query.sessions.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }
  if (input.table === "integrationConnectionRedirectSessions") {
    return input.env.controlPlaneDb.query.integrationConnectionRedirectSessions.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }
  if (input.table === "identityLinkRedirectSessions") {
    return input.env.controlPlaneDb.query.identityLinkRedirectSessions.findMany({
      columns: { id: true },
      where: (table, { inArray }) => inArray(table.id, input.ids),
    });
  }

  return input.env.controlPlaneDb.query.integrationConnectionDeviceAuthorizationAttempts.findMany({
    columns: { id: true },
    where: (table, { inArray }) => inArray(table.id, input.ids),
  });
}

function sandboxInstanceRow(
  input: Partial<DataPlaneTables["sandboxInstances"]["$inferInsert"]> & { id: string },
): DataPlaneTables["sandboxInstances"]["$inferInsert"] {
  return {
    organizationId: "org_maintenance_events",
    sandboxProfileId: "sbp_maintenance_events",
    sandboxProfileVersion: 1,
    runtimeProvider: SandboxInstanceProviders.DOCKER,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: SandboxInstanceStarterKinds.SYSTEM,
    startedById: "maintenance-events",
    source: SandboxInstanceSources.SYSTEM,
    purpose: SandboxInstancePurposes.SESSION,
    ...input,
  };
}

function sandboxOperationEventRow(
  input: Partial<DataPlaneTables["sandboxOperationEvents"]["$inferInsert"]> & {
    id: string;
    sandboxInstanceId: string;
    sequence: number;
  },
): DataPlaneTables["sandboxOperationEvents"]["$inferInsert"] {
  return {
    operationKind: SandboxOperationKinds.START,
    operationId: `op_maintenance_events_${input.sandboxInstanceId}`,
    recordKind: SandboxOperationEventRecordKinds.LIFECYCLE,
    observedAt: iso(FixedNowMs),
    source: SandboxOperationEventSources.WORKER,
    phase: "provider",
    status: "completed",
    message: "Maintenance event",
    attributes: {},
    ...input,
  };
}

async function expectExistingSandboxOperationEventIds(input: {
  env: IntegrationTestEnvironment;
  ids: string[];
  expectedIds: string[];
}): Promise<void> {
  const rows = await input.env.dataPlaneDb.query.sandboxOperationEvents.findMany({
    columns: { id: true },
    where: (table, { inArray }) => inArray(table.id, input.ids),
  });
  expect(rows.map((row) => row.id).sort()).toEqual(input.expectedIds.toSorted());
}

function hours(value: number): number {
  return value * 60 * 60 * 1_000;
}

function days(value: number): number {
  return value * 24 * 60 * 60 * 1_000;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
