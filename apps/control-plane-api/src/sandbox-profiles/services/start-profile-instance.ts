import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { StartSandboxProfileInstanceWorkflowSpec } from "@mistle/workflows/control-plane";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "./errors.js";

const START_SANDBOX_PROFILE_INSTANCE_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileInstanceOutput = {
  status: "completed";
  workflowRunId: string;
  sandboxInstanceId: string;
  providerSandboxId: string;
};

function createIdempotencyKey(input: StartProfileInstanceInput): string {
  return JSON.stringify({
    organizationId: input.organizationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    startedBy: {
      kind: input.startedBy.kind,
      id: input.startedBy.id,
    },
    source: input.source,
  });
}

export async function startProfileInstance(
  { db, openWorkflow }: Pick<CreateSandboxProfilesServiceInput, "db" | "openWorkflow">,
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, serviceInput.profileId),
        eq(table.organizationId, serviceInput.organizationId),
      ),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
      version: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, serviceInput.profileId),
        eq(table.version, serviceInput.profileVersion),
      ),
  });
  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  const workflowRunHandle = await openWorkflow.runWorkflow(
    StartSandboxProfileInstanceWorkflowSpec,
    {
      organizationId: serviceInput.organizationId,
      sandboxProfileId: serviceInput.profileId,
      sandboxProfileVersion: serviceInput.profileVersion,
      startedBy: serviceInput.startedBy,
      source: serviceInput.source,
    },
    {
      idempotencyKey: createIdempotencyKey(serviceInput),
    },
  );
  const workflowResult = await workflowRunHandle.result({
    timeoutMs: START_SANDBOX_PROFILE_INSTANCE_WAIT_TIMEOUT_MS,
  });

  return {
    status: "completed",
    workflowRunId: workflowResult.workflowRunId,
    sandboxInstanceId: workflowResult.sandboxInstanceId,
    providerSandboxId: workflowResult.providerSandboxId,
  };
}
