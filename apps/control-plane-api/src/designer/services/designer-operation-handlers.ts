import { createHash } from "node:crypto";

import {
  type DesignerActionRequestOperation,
  type DesignerActionRequestOperationResult,
  DesignerActionRequestOperationKinds,
  DesignerActionRequestStatuses,
} from "@mistle/db/control-plane";

import { requireOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { publishProfileVersion } from "../../sandbox-profiles/services/publish-profile-version.js";
import { putProfileVersionDraft } from "../../sandbox-profiles/services/put-profile-version-draft.js";
import { startProfileInstance } from "../../sandbox-profiles/services/start-profile-instance.js";
import type { CreateSandboxProfilesServiceInput } from "../../sandbox-profiles/services/types.js";

export type DesignerOperationExecutionContext = Pick<
  CreateSandboxProfilesServiceInput,
  | "db"
  | "cache"
  | "dataPlaneClient"
  | "integrationsConfig"
  | "integrationRegistry"
  | "mcpConfig"
  | "sandboxConfig"
>;

type DesignerOperationHandlerInput = {
  organizationId: string;
  actionRequestId: string;
  requestedByUserId: string;
  operation: DesignerActionRequestOperation;
};

type DesignerOperationHandlerResult =
  | {
      status: typeof DesignerActionRequestStatuses.COMPLETED;
      failureCode: null;
      failureMessage: null;
      operationResult: DesignerActionRequestOperationResult;
    }
  | {
      status:
        | typeof DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED
        | typeof DesignerActionRequestStatuses.FAILED;
      failureCode: string;
      failureMessage: string;
      operationResult: null;
    };

type DesignerOperationHandler = (
  ctx: DesignerOperationExecutionContext,
  input: DesignerOperationHandlerInput,
) => Promise<DesignerOperationHandlerResult>;

const DesignerOperationHandlers: Partial<
  Record<DesignerActionRequestOperation["kind"], DesignerOperationHandler>
> = {
  [DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_PUBLISH]:
    executeSandboxProfileDraftPublishOperation,
  [DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT]:
    executeSandboxProfileDraftSetupScriptPutOperation,
  [DesignerActionRequestOperationKinds.SANDBOX_PROFILE_VERSION_LAUNCH]:
    executeSandboxProfileVersionLaunchOperation,
};

function getDesignerOperationFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  return "DESIGNER_OPERATION_HANDLER_FAILED";
}

function getDesignerOperationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Designer operation handler failed.";
}

function createDesignerLaunchStartIdempotencyKey(input: {
  actionRequestId: string;
  operationIdempotencyKey: string;
}): string {
  const digest = createHash("sha256").update(input.operationIdempotencyKey).digest("hex");
  return `designer-action-request:${input.actionRequestId}:launch:${digest}`;
}

export async function executeApprovedDesignerOperation(
  ctx: DesignerOperationExecutionContext,
  input: DesignerOperationHandlerInput,
): Promise<DesignerOperationHandlerResult> {
  const handler = DesignerOperationHandlers[input.operation.kind];
  if (handler === undefined) {
    return {
      status: DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
      failureCode: "DESIGNER_OPERATION_HANDLER_UNSUPPORTED",
      failureMessage: `Designer operation kind '${input.operation.kind}' does not have an execution handler.`,
      operationResult: null,
    };
  }

  try {
    return await handler(ctx, input);
  } catch (error) {
    return {
      status: DesignerActionRequestStatuses.FAILED,
      failureCode: getDesignerOperationFailureCode(error),
      failureMessage: getDesignerOperationFailureMessage(error),
      operationResult: null,
    };
  }
}

async function executeSandboxProfileDraftSetupScriptPutOperation(
  ctx: DesignerOperationExecutionContext,
  input: DesignerOperationHandlerInput,
): Promise<DesignerOperationHandlerResult> {
  if (
    input.operation.kind !==
    DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT
  ) {
    throw new Error(
      `Designer operation handler received unexpected operation kind '${input.operation.kind}'.`,
    );
  }

  await requireOrganizationPermission({
    db: ctx.db,
    actorUserId: input.requestedByUserId,
    organizationId: input.organizationId,
    permission: OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  });

  await putProfileVersionDraft(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      sandboxConfig: ctx.sandboxConfig,
    },
    {
      organizationId: input.organizationId,
      profileId: input.operation.profileId,
      profileVersion: input.operation.version,
      setupScript: input.operation.setupScript,
    },
  );

  return {
    status: DesignerActionRequestStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
    operationResult: {
      kind: input.operation.kind,
      profileId: input.operation.profileId,
      version: input.operation.version,
    },
  };
}

async function executeSandboxProfileDraftPublishOperation(
  ctx: DesignerOperationExecutionContext,
  input: DesignerOperationHandlerInput,
): Promise<DesignerOperationHandlerResult> {
  if (input.operation.kind !== DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_PUBLISH) {
    throw new Error(
      `Designer operation handler received unexpected operation kind '${input.operation.kind}'.`,
    );
  }

  await requireOrganizationPermission({
    db: ctx.db,
    actorUserId: input.requestedByUserId,
    organizationId: input.organizationId,
    permission: OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  });

  const published = await publishProfileVersion(
    {
      db: ctx.db,
      dataPlaneClient: ctx.dataPlaneClient,
      defaultBaseImage: ctx.sandboxConfig.defaultBaseImage,
      integrationsConfig: ctx.integrationsConfig,
      integrationRegistry: ctx.integrationRegistry,
      mcpConfig: ctx.mcpConfig,
      sandboxConfig: ctx.sandboxConfig,
    },
    {
      organizationId: input.organizationId,
      profileId: input.operation.profileId,
      profileVersion: input.operation.version,
    },
  );
  if (published.version.publishedAt === null) {
    throw new Error(
      `Published sandbox profile '${input.operation.profileId}' version '${String(input.operation.version)}' is missing published_at.`,
    );
  }

  return {
    status: DesignerActionRequestStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
    operationResult: {
      kind: input.operation.kind,
      profileId: input.operation.profileId,
      version: input.operation.version,
      publishedAt: published.version.publishedAt,
      snapshotAction:
        published.snapshotAction.kind === "created"
          ? {
              kind: "created",
              snapshotJobId: published.snapshotAction.job.id,
              sandboxInstanceId: published.snapshotAction.job.sandboxInstanceId,
            }
          : {
              kind: "reused",
              snapshotImageProvider: published.snapshotAction.snapshotImageProvider,
              snapshotImageId: published.snapshotAction.snapshotImageId,
            },
    },
  };
}

async function executeSandboxProfileVersionLaunchOperation(
  ctx: DesignerOperationExecutionContext,
  input: DesignerOperationHandlerInput,
): Promise<DesignerOperationHandlerResult> {
  if (input.operation.kind !== DesignerActionRequestOperationKinds.SANDBOX_PROFILE_VERSION_LAUNCH) {
    throw new Error(
      `Designer operation handler received unexpected operation kind '${input.operation.kind}'.`,
    );
  }

  await requireOrganizationPermission({
    db: ctx.db,
    actorUserId: input.requestedByUserId,
    organizationId: input.organizationId,
    permission: OrganizationPermissions.SANDBOX_SESSION_CREATE,
  });

  const launched = await startProfileInstance(
    {
      db: ctx.db,
      cache: ctx.cache,
      integrationsConfig: ctx.integrationsConfig,
      mcpConfig: ctx.mcpConfig,
      dataPlaneClient: ctx.dataPlaneClient,
      defaultBaseImage: ctx.sandboxConfig.defaultBaseImage,
    },
    {
      organizationId: input.organizationId,
      profileId: input.operation.profileId,
      profileVersion: input.operation.version,
      startedBy: {
        kind: "user",
        id: input.requestedByUserId,
      },
      actingUser: {
        userId: input.requestedByUserId,
      },
      source: "dashboard",
      ...(input.operation.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: input.operation.primaryRepositoryId }),
      idempotencyKey: createDesignerLaunchStartIdempotencyKey({
        actionRequestId: input.actionRequestId,
        operationIdempotencyKey: input.operation.idempotencyKey,
      }),
    },
  );

  return {
    status: DesignerActionRequestStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
    operationResult: {
      kind: input.operation.kind,
      profileId: input.operation.profileId,
      version: input.operation.version,
      sandboxInstanceId: launched.sandboxInstanceId,
      workflowRunId: launched.workflowRunId,
    },
  };
}
