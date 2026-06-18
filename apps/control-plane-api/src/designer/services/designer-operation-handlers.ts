import { createHash } from "node:crypto";

import {
  type DesignerActionRequestOperation,
  DesignerActionRequestOperationKinds,
  DesignerActionRequestStatuses,
  type DesignerActionRequestStatus,
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

type DesignerOperationHandlerResult = {
  status: DesignerActionRequestStatus;
  failureCode: string | null;
  failureMessage: string | null;
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
    };
  }

  try {
    return await handler(ctx, input);
  } catch (error) {
    return {
      status: DesignerActionRequestStatuses.FAILED,
      failureCode: getDesignerOperationFailureCode(error),
      failureMessage: getDesignerOperationFailureMessage(error),
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

  await publishProfileVersion(
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

  return {
    status: DesignerActionRequestStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
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

  await startProfileInstance(
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
  };
}
