import {
  type ControlPlaneDatabase,
  identityLinkRedirectSessions,
  integrationConnectionDeviceAuthorizationAttempts,
  IntegrationDeviceAuthorizationAttemptStatuses,
  integrationConnectionRedirectSessions,
  integrationConnections,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  organizations,
  sessions,
  users,
  verifications,
} from "@mistle/db/control-plane";
import type { Clock } from "@mistle/time";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  PruneExpiredAuthStateCommand,
  pruneExpiredAuthState,
} from "../src/maintenance/commands/prune-expired-auth-state.js";
import {
  PruneExpiredIntegrationAuthStateCommand,
  pruneExpiredIntegrationAuthState,
} from "../src/maintenance/commands/prune-expired-integration-auth-state.js";
import {
  acquireMaintenanceAdvisoryLock,
  MaintenanceLockUnavailableError,
  releaseMaintenanceAdvisoryLock,
} from "../src/maintenance/shared/advisory-lock.js";
import { runMaintenanceCommand } from "../src/maintenance/shared/run-maintenance-command.js";
import { it } from "./test-context.js";

const FixedNowMs = Date.UTC(2026, 3, 29, 0, 0, 0);
const FixedClock: Clock = {
  nowMs: () => FixedNowMs,
  nowDate: () => new Date(FixedNowMs),
};

describe("maintenance commands", () => {
  it("prunes expired auth state after the retention grace", async ({ fixture }) => {
    const user = await seedUser(fixture.db, "auth-state");
    const oldVerificationId = "vrf_maintenance_old";
    const recentVerificationId = "vrf_maintenance_recent";
    const futureVerificationId = "vrf_maintenance_future";
    const oldSessionId = "ses_maintenance_old";
    const recentSessionId = "ses_maintenance_recent";
    const futureSessionId = "ses_maintenance_future";

    await fixture.db.insert(verifications).values([
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
    await fixture.db.insert(sessions).values([
      {
        id: oldSessionId,
        userId: user.id,
        token: "maintenance-old-session",
        expiresAt: new Date(FixedNowMs - hours(25)),
      },
      {
        id: recentSessionId,
        userId: user.id,
        token: "maintenance-recent-session",
        expiresAt: new Date(FixedNowMs - hours(23)),
      },
      {
        id: futureSessionId,
        userId: user.id,
        token: "maintenance-future-session",
        expiresAt: new Date(FixedNowMs + hours(1)),
      },
    ]);

    const result = await pruneExpiredAuthState({
      db: fixture.db,
      clock: FixedClock,
    });

    expect(result).toEqual({
      deletedRowCounts: {
        verifications: 1,
        sessions: 1,
      },
      reachedMaxBatches: false,
    });
    await expectExistingIds(
      fixture.db
        .select({ id: verifications.id })
        .from(verifications)
        .where(
          inArray(verifications.id, [
            oldVerificationId,
            recentVerificationId,
            futureVerificationId,
          ]),
        ),
      [recentVerificationId, futureVerificationId],
    );
    await expectExistingIds(
      fixture.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(inArray(sessions.id, [oldSessionId, recentSessionId, futureSessionId])),
      [recentSessionId, futureSessionId],
    );
  });

  it("prunes expired integration auth state after command-specific retention", async ({
    fixture,
  }) => {
    const graph = await seedIntegrationAuthGraph(fixture.db, "integration-auth-state");
    const oldConnectionRedirectSessionId = "ios_maintenance_old";
    const recentConnectionRedirectSessionId = "ios_maintenance_recent";
    const oldIdentityLinkRedirectSessionId = "ilr_maintenance_old";
    const recentIdentityLinkRedirectSessionId = "ilr_maintenance_recent";
    const oldTerminalAttemptId = "ida_maintenance_terminal_old";
    const recentTerminalAttemptId = "ida_maintenance_terminal_recent";
    const oldPendingAttemptId = "ida_maintenance_pending_old";
    const recentPendingAttemptId = "ida_maintenance_pending_recent";
    const pendingWithoutExpiryAttemptId = "ida_maintenance_pending_no_expiry";

    await fixture.db.insert(integrationConnectionRedirectSessions).values([
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
    await fixture.db.insert(identityLinkRedirectSessions).values([
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
    await fixture.db.insert(integrationConnectionDeviceAuthorizationAttempts).values([
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

    const result = await pruneExpiredIntegrationAuthState({
      db: fixture.db,
      clock: FixedClock,
    });

    expect(result).toEqual({
      deletedRowCounts: {
        integration_connection_redirect_sessions: 1,
        identity_link_redirect_sessions: 1,
        integration_connection_device_authorization_attempts_terminal: 1,
        integration_connection_device_authorization_attempts_pending_expired: 1,
      },
      reachedMaxBatches: false,
    });
    await expectExistingIds(
      fixture.db
        .select({ id: integrationConnectionRedirectSessions.id })
        .from(integrationConnectionRedirectSessions)
        .where(
          inArray(integrationConnectionRedirectSessions.id, [
            oldConnectionRedirectSessionId,
            recentConnectionRedirectSessionId,
          ]),
        ),
      [recentConnectionRedirectSessionId],
    );
    await expectExistingIds(
      fixture.db
        .select({ id: identityLinkRedirectSessions.id })
        .from(identityLinkRedirectSessions)
        .where(
          inArray(identityLinkRedirectSessions.id, [
            oldIdentityLinkRedirectSessionId,
            recentIdentityLinkRedirectSessionId,
          ]),
        ),
      [recentIdentityLinkRedirectSessionId],
    );
    await expectExistingIds(
      fixture.db
        .select({ id: integrationConnectionDeviceAuthorizationAttempts.id })
        .from(integrationConnectionDeviceAuthorizationAttempts)
        .where(
          inArray(integrationConnectionDeviceAuthorizationAttempts.id, [
            oldTerminalAttemptId,
            recentTerminalAttemptId,
            oldPendingAttemptId,
            recentPendingAttemptId,
            pendingWithoutExpiryAttemptId,
          ]),
        ),
      [recentTerminalAttemptId, recentPendingAttemptId, pendingWithoutExpiryAttemptId],
    );
  });

  it("prevents concurrent runs of the same maintenance command", async ({ fixture }) => {
    const pool = new Pool({
      connectionString: fixture.databaseStack.directUrl,
    });
    const lockClient = await pool.connect();

    try {
      await acquireMaintenanceAdvisoryLock({
        client: lockClient,
        commandName: PruneExpiredAuthStateCommand.name,
      });

      await expect(
        runMaintenanceCommand({
          command: PruneExpiredAuthStateCommand,
          pool,
          clock: FixedClock,
        }),
      ).rejects.toBeInstanceOf(MaintenanceLockUnavailableError);
    } finally {
      await releaseMaintenanceAdvisoryLock({
        client: lockClient,
        commandName: PruneExpiredAuthStateCommand.name,
      });
      lockClient.release();
      await pool.end();
    }
  });

  it("uses independent locks for different maintenance commands", async ({ fixture }) => {
    const pool = new Pool({
      connectionString: fixture.databaseStack.directUrl,
    });
    const lockClient = await pool.connect();

    try {
      await acquireMaintenanceAdvisoryLock({
        client: lockClient,
        commandName: PruneExpiredAuthStateCommand.name,
      });

      await expect(
        runMaintenanceCommand({
          command: PruneExpiredIntegrationAuthStateCommand,
          pool,
          clock: FixedClock,
        }),
      ).resolves.toEqual({
        deletedRowCounts: {
          integration_connection_redirect_sessions: 0,
          identity_link_redirect_sessions: 0,
          integration_connection_device_authorization_attempts_terminal: 0,
          integration_connection_device_authorization_attempts_pending_expired: 0,
        },
        reachedMaxBatches: false,
      });
    } finally {
      await releaseMaintenanceAdvisoryLock({
        client: lockClient,
        commandName: PruneExpiredAuthStateCommand.name,
      });
      lockClient.release();
      await pool.end();
    }
  });
});

async function seedUser(db: ControlPlaneDatabase, label: string): Promise<{ id: string }> {
  const id = `usr_maintenance_${label.replaceAll("-", "_")}`;
  await db.insert(users).values({
    id,
    name: `Maintenance ${label}`,
    email: `${label}@maintenance.example.com`,
  });

  return { id };
}

async function seedIntegrationAuthGraph(
  db: ControlPlaneDatabase,
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
  const organizationId = `org_maintenance_${normalizedLabel}`;
  const userId = `usr_maintenance_${normalizedLabel}`;
  const targetKey = `maintenance-${label}`;
  const providerFamily = `maintenance-${label}`;
  const integrationConnectionId = `icn_maintenance_${normalizedLabel}`;
  const providerConfigId = `ilp_maintenance_${normalizedLabel}`;

  await db.insert(organizations).values({
    id: organizationId,
    name: `Maintenance ${label}`,
    slug: `maintenance-${label}`,
  });
  await db.insert(users).values({
    id: userId,
    name: `Maintenance ${label}`,
    email: `${label}@maintenance.example.com`,
  });
  await db.insert(integrationTargets).values({
    targetKey,
    familyId: `maintenance-${label}`,
    variantId: "default",
    enabled: true,
    config: {},
  });
  await db.insert(integrationConnections).values({
    id: integrationConnectionId,
    organizationId,
    targetKey,
    displayName: `Maintenance ${label}`,
  });
  await db.insert(organizationIdentityLinkProviderConfigs).values({
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

async function expectExistingIds(
  query: Promise<Array<{ id: string }>>,
  expectedIds: string[],
): Promise<void> {
  const rows = await query;
  expect(rows.map((row) => row.id).sort()).toEqual(expectedIds.toSorted());
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
