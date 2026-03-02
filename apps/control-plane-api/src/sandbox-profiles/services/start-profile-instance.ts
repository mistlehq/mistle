import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { BootstrapTokenConfig } from "@mistle/tunnel-auth";
import type { StartSandboxProfileInstanceWorkflowInput } from "@mistle/workflows/control-plane";
import { StartSandboxProfileInstanceWorkflowSpec } from "@mistle/workflows/control-plane";

import { compileProfileVersionRuntimePlan } from "./compile-profile-version-runtime-plan.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

const START_SANDBOX_PROFILE_INSTANCE_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const SandboxdEgressBaseUrl = "http://sandboxd.internal/egress";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  issueConnectionToken?: boolean;
  connectionToken?: {
    gatewayWebsocketUrl: string;
    tokenTtlSeconds: number;
    tokenConfig: BootstrapTokenConfig;
  };
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxProfileInstanceWorkflowInput["image"];
};

type StartProfileInstanceOutput = {
  status: "completed";
  workflowRunId: string;
  sandboxInstanceId: string;
  providerSandboxId: string;
  connection?: {
    url: string;
    token: string;
    expiresAt: string;
  };
};

function createIdempotencyKey(input: {
  serviceInput: StartProfileInstanceInput;
  runtimePlan: StartSandboxProfileInstanceWorkflowInput["runtimePlan"];
}): string {
  return JSON.stringify({
    organizationId: input.serviceInput.organizationId,
    sandboxProfileId: input.serviceInput.profileId,
    sandboxProfileVersion: input.serviceInput.profileVersion,
    startedBy: {
      kind: input.serviceInput.startedBy.kind,
      id: input.serviceInput.startedBy.id,
    },
    source: input.serviceInput.source,
    image: input.serviceInput.image,
    runtimePlan: input.runtimePlan,
  });
}

export async function startProfileInstance(
  {
    db,
    openWorkflow,
    mintSandboxInstanceConnectionToken,
  }: Pick<
    CreateSandboxProfilesServiceInput,
    "db" | "openWorkflow" | "mintSandboxInstanceConnectionToken"
  >,
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const runtimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      image: {
        source: "base",
        imageRef: serviceInput.image.imageId,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: SandboxdEgressBaseUrl,
      },
    },
  );

  const workflowRunHandle = await openWorkflow.runWorkflow(
    StartSandboxProfileInstanceWorkflowSpec,
    {
      organizationId: serviceInput.organizationId,
      sandboxProfileId: serviceInput.profileId,
      sandboxProfileVersion: serviceInput.profileVersion,
      runtimePlan,
      startedBy: serviceInput.startedBy,
      source: serviceInput.source,
      image: serviceInput.image,
    },
    {
      idempotencyKey: createIdempotencyKey({
        serviceInput,
        runtimePlan,
      }),
    },
  );
  const workflowResult = await workflowRunHandle.result({
    timeoutMs: START_SANDBOX_PROFILE_INSTANCE_WAIT_TIMEOUT_MS,
  });

  if (serviceInput.issueConnectionToken !== true) {
    return {
      status: "completed",
      workflowRunId: workflowResult.workflowRunId,
      sandboxInstanceId: workflowResult.sandboxInstanceId,
      providerSandboxId: workflowResult.providerSandboxId,
    };
  }

  if (serviceInput.connectionToken === undefined) {
    throw new Error(
      "Connection token configuration is required when issueConnectionToken is enabled.",
    );
  }
  if (mintSandboxInstanceConnectionToken === undefined) {
    throw new Error("Sandbox instance connection token minting is not configured.");
  }

  const connectionToken = await mintSandboxInstanceConnectionToken({
    organizationId: serviceInput.organizationId,
    instanceId: workflowResult.sandboxInstanceId,
    gatewayWebsocketUrl: serviceInput.connectionToken.gatewayWebsocketUrl,
    tokenTtlSeconds: serviceInput.connectionToken.tokenTtlSeconds,
    tokenConfig: serviceInput.connectionToken.tokenConfig,
  });

  return {
    status: "completed",
    workflowRunId: workflowResult.workflowRunId,
    sandboxInstanceId: workflowResult.sandboxInstanceId,
    providerSandboxId: workflowResult.providerSandboxId,
    connection: {
      url: connectionToken.url,
      token: connectionToken.token,
      expiresAt: connectionToken.expiresAt,
    },
  };
}
