import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import type { SandboxActingUser } from "../../../sandbox-profiles/services/resolve-acting-user-git-identity.js";
import { startProfileInstance as startSandboxProfileInstance } from "../../../sandbox-profiles/services/start-profile-instance.js";
import type { AppContext } from "../../../types.js";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  primaryRepositoryId?: string | null;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  actingUser?: SandboxActingUser;
  source: SandboxInstanceSource;
};

export async function startProfileInstance(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: {
    db: AppContext["var"]["db"];
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    dataPlaneClient: AppContext["var"]["dataPlaneClient"];
    defaultBaseImage: string;
  },
  input: StartProfileInstanceInput,
): Promise<{
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
}> {
  return startSandboxProfileInstance(
    {
      db,
      integrationsConfig,
      dataPlaneClient,
      defaultBaseImage,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      ...(input.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: input.primaryRepositoryId }),
      startedBy: input.startedBy,
      ...(input.actingUser === undefined ? {} : { actingUser: input.actingUser }),
      source: input.source,
    },
  );
}
