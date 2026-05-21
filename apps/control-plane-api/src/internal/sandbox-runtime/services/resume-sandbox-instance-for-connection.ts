import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { readProfileVersionGitCommitSigningIntegrationConnectionId } from "../../../sandbox-profiles/services/profile-version-git-signing-selector.js";
import { resolveActingUserGitIdentity } from "../../../sandbox-profiles/services/resolve-acting-user-git-identity.js";

export async function resumeSandboxInstanceForConnection(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
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
  const gitIdentity =
    input.actingUserId === undefined
      ? undefined
      : await resolveActingUserGitIdentityForSandboxInstance(
          { db, dataPlaneClient },
          {
            organizationId: input.organizationId,
            instanceId: input.instanceId,
            actingUserId: input.actingUserId,
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
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: {
    organizationId: string;
    instanceId: string;
    actingUserId: string;
  },
) {
  const sandboxInstance = await ctx.dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    return undefined;
  }

  const gitCommitSigningIntegrationConnectionId =
    await readProfileVersionGitCommitSigningIntegrationConnectionId(ctx.db, {
      profileId: sandboxInstance.sandboxProfileId,
      profileVersion: sandboxInstance.sandboxProfileVersion,
    });

  return await resolveActingUserGitIdentity(ctx.db, {
    organizationId: input.organizationId,
    gitCommitSigningIntegrationConnectionId,
    actingUser: {
      userId: input.actingUserId,
    },
  });
}
