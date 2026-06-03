import type { Cache } from "@mistle/cache";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { IntegrationBindingKinds, type ControlPlaneDatabase } from "@mistle/db/control-plane";

import { readProfileVersionGitCommitSigningIntegrationConnectionId } from "../../../sandbox-profiles/services/profile-version-git-signing-selector.js";
import { resolveActingUserGitIdentity } from "../../../sandbox-profiles/services/resolve-acting-user-git-identity.js";

export async function resumeSandboxInstanceForConnection(
  {
    db,
    cache,
    integrationsConfig,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    cache: Cache;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "resumeSandboxInstance"
    >;
  },
  input: {
    organizationId: string;
    instanceId: string;
    actingUserId?: string;
    idempotencyKey?: string;
  },
) {
  const gitIdentity = await resolveActingUserGitIdentityForSandboxInstance(
    { db, cache, integrationsConfig, dataPlaneClient },
    {
      organizationId: input.organizationId,
      instanceId: input.instanceId,
      ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    },
  );

  return await dataPlaneClient.resumeSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
}

async function resolveActingUserGitIdentityForSandboxInstance(
  ctx: {
    db: ControlPlaneDatabase;
    cache: Cache;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: {
    organizationId: string;
    instanceId: string;
    actingUserId?: string;
  },
) {
  const sandboxInstance = await ctx.dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    return undefined;
  }

  const gitIntegrationConnectionId = await readProfileVersionGitIntegrationConnectionId(ctx.db, {
    profileId: sandboxInstance.sandboxProfileId,
    profileVersion: sandboxInstance.sandboxProfileVersion,
  });
  if (gitIntegrationConnectionId === null) {
    return undefined;
  }
  const gitCommitSigningIntegrationConnectionId =
    await readProfileVersionGitCommitSigningIntegrationConnectionId(ctx.db, {
      profileId: sandboxInstance.sandboxProfileId,
      profileVersion: sandboxInstance.sandboxProfileVersion,
    });

  return await resolveActingUserGitIdentity(ctx.db, {
    cache: ctx.cache,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: input.organizationId,
    gitIntegrationConnectionId,
    gitCommitSigningIntegrationConnectionId,
    ...(input.actingUserId === undefined
      ? {}
      : {
          actingUser: {
            userId: input.actingUserId,
          },
        }),
  });
}

async function readProfileVersionGitIntegrationConnectionId(
  db: ControlPlaneDatabase,
  input: {
    profileId: string;
    profileVersion: number;
  },
): Promise<string | null> {
  const gitBinding = await db.query.sandboxProfileVersionIntegrationBindings.findFirst({
    columns: {
      connectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
        eq(table.kind, IntegrationBindingKinds.GIT),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  return gitBinding?.connectionId ?? null;
}
