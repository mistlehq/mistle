import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { resolveActingUserGitIdentity } from "../../../sandbox-profiles/services/resolve-acting-user-git-identity.js";

export async function resumeSandboxInstanceForConnection(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "resumeSandboxInstance">;
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
      : await resolveActingUserGitIdentity(db, {
          organizationId: input.organizationId,
          actingUser: {
            userId: input.actingUserId,
          },
        });

  return await dataPlaneClient.resumeSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
}
