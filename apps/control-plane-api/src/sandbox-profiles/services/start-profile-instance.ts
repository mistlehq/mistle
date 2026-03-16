import { randomUUID } from "node:crypto";

import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { compileProfileVersionRuntimePlan } from "./compile-profile-version-runtime-plan.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: {
    imageId: string;
    createdAt: string;
  };
};

type StartProfileInstanceOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

export async function startProfileInstance(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient">,
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const idempotencyKey = serviceInput.idempotencyKey ?? randomUUID();
  const runtimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      image: {
        source: "base",
        imageRef: serviceInput.image.imageId,
      },
    },
  );

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.profileId,
    sandboxProfileVersion: serviceInput.profileVersion,
    idempotencyKey,
    runtimePlan,
    startedBy: serviceInput.startedBy,
    source: serviceInput.source,
    image: serviceInput.image,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}
