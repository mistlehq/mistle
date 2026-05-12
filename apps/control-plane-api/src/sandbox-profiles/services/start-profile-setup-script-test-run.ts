import { type SandboxInstanceSource } from "@mistle/db/data-plane";
import { type SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { startProfileSetupCheckSandbox } from "./start-profile-setup-check-sandbox.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileSetupScriptTestRunInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileSetupScriptTestRunOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

export async function startProfileSetupScriptTestRun(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: StartProfileSetupScriptTestRunInput,
): Promise<StartProfileSetupScriptTestRunOutput> {
  return await startProfileSetupCheckSandbox(
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
      startedBy: input.startedBy,
      source: input.source,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    },
  );
}
