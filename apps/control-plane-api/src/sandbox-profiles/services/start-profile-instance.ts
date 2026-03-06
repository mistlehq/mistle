import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { compileProfileVersionRuntimePlan } from "./compile-profile-version-runtime-plan.js";
import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export const SandboxdEgressBaseUrl = "http://127.0.0.1:8090/egress";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  restoreFromSourceInstanceId?: string;
  sandboxInstanceId?: string;
  image: {
    imageId: string;
    kind: "base" | "snapshot";
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
  let runtimePlanImage:
    | {
        source: "base";
        imageRef: string;
      }
    | {
        source: "snapshot";
        imageRef: string;
        instanceId: string;
      };
  let startImage = serviceInput.image;

  if (serviceInput.restoreFromSourceInstanceId === undefined) {
    runtimePlanImage = {
      source: "base",
      imageRef: serviceInput.image.imageId,
    };
  } else {
    const latestSnapshot = await dataPlaneClient.getLatestSandboxInstanceSnapshot({
      organizationId: serviceInput.organizationId,
      sourceInstanceId: serviceInput.restoreFromSourceInstanceId,
    });
    if (latestSnapshot === null) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.SNAPSHOT_NOT_FOUND,
        `Sandbox snapshot for source instance '${serviceInput.restoreFromSourceInstanceId}' was not found.`,
      );
    }

    runtimePlanImage = {
      source: "snapshot",
      imageRef: latestSnapshot.image.imageId,
      instanceId: serviceInput.restoreFromSourceInstanceId,
    };
    startImage = latestSnapshot.image;
  }

  const runtimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      image: runtimePlanImage,
      runtimeContext: {
        sandboxdEgressBaseUrl: SandboxdEgressBaseUrl,
      },
    },
  );

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.profileId,
    sandboxProfileVersion: serviceInput.profileVersion,
    runtimePlan,
    startedBy: serviceInput.startedBy,
    source: serviceInput.source,
    ...(serviceInput.sandboxInstanceId === undefined
      ? {}
      : {
          sandboxInstanceId: serviceInput.sandboxInstanceId,
        }),
    image: startImage,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}
