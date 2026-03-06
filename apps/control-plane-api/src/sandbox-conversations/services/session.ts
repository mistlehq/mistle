import {
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationRouteStatuses,
  ConversationStatuses,
  IntegrationBindingKinds,
  conversations,
  conversationRoutes,
} from "@mistle/db/control-plane";
import { systemScheduler } from "@mistle/time";
import { and, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import {
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundError,
  SandboxInstancesNotFoundCodes,
} from "../../sandbox-instances/index.js";
import {
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../../sandbox-profiles/services/errors.js";
import { createCodexProviderConversation } from "./codex-provider.js";
import {
  SandboxConversationsBadRequestCodes,
  SandboxConversationsBadRequestError,
  SandboxConversationsConflictCodes,
  SandboxConversationsConflictError,
  SandboxConversationsNotFoundCodes,
  SandboxConversationsNotFoundError,
} from "./errors.js";
import type {
  CreateSandboxConversationsServiceInput,
  StartConversationSessionResult,
} from "./types.js";

type ResolvedConversationProfile = {
  profileId: string;
  profileVersion: number;
};

type RouteContinuityResult = {
  routeId: string;
  sandboxInstanceId: string;
  workflowRunId: string | null;
};

const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

function createStartImage(defaultBaseImage: string): {
  imageId: string;
  kind: "base";
  createdAt: string;
} {
  return {
    imageId: defaultBaseImage,
    kind: "base",
    createdAt: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProviderModelFromBindingConfig(config: unknown): string {
  if (!isRecord(config)) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
      "Integration binding config must be an object.",
    );
  }

  const defaultModelValue = config.defaultModel;
  if (typeof defaultModelValue !== "string" || defaultModelValue.trim().length === 0) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
      "Integration binding config.defaultModel must be a non-empty string.",
    );
  }

  return defaultModelValue;
}

function resolveProviderFamilyFromTargetFamily(targetFamilyId: string): "codex" {
  if (targetFamilyId === "openai") {
    return "codex";
  }

  throw new SandboxConversationsBadRequestError(
    SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
    `Integration binding uses unsupported target family '${targetFamilyId}' for dashboard conversation sessions.`,
  );
}

async function waitForSandboxInstanceRunning(input: {
  deps: CreateSandboxConversationsServiceInput;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const deadline = Date.now() + SandboxStartTimeoutMs;

  while (Date.now() < deadline) {
    const sandboxInstance = await input.deps.sandboxInstances.getInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });

    if (sandboxInstance.status === "running") {
      return;
    }
    if (sandboxInstance.status === "failed" || sandboxInstance.status === "stopped") {
      throw new SandboxConversationsConflictError(
        SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
        sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}' before provider conversation activation.`,
      );
    }

    await new Promise<void>((resolve) => {
      systemScheduler.schedule(resolve, SandboxStartPollIntervalMs);
    });
  }

  throw new SandboxConversationsConflictError(
    SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
    `Sandbox instance '${input.sandboxInstanceId}' did not become ready before provider conversation activation timeout.`,
  );
}

function rethrowStartProfileError(error: unknown): never {
  if (error instanceof SandboxProfilesNotFoundError) {
    if (error.code === SandboxProfilesNotFoundCodes.SNAPSHOT_NOT_FOUND) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.CONVERSATION_SNAPSHOT_MISSING,
        "No snapshot is available to recover this conversation sandbox.",
      );
    }

    if (error.code === SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.PROFILE_NOT_FOUND,
        error.message,
      );
    }

    if (error.code === SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        error.message,
      );
    }
  }

  throw error;
}

async function resolveConversationProfile(input: {
  deps: CreateSandboxConversationsServiceInput;
  conversation: {
    id: string;
    ownerKind: string;
    ownerId: string;
    sandboxProfileId: string;
  };
}): Promise<ResolvedConversationProfile> {
  if (input.conversation.ownerKind === ConversationOwnerKinds.INTEGRATION_BINDING) {
    const integrationBinding =
      await input.deps.db.query.sandboxProfileVersionIntegrationBindings.findFirst({
        columns: {
          sandboxProfileId: true,
          sandboxProfileVersion: true,
        },
        where: (table, { eq: whereEq }) => whereEq(table.id, input.conversation.ownerId),
      });

    if (integrationBinding === undefined) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.INTEGRATION_BINDING_NOT_FOUND,
        `Integration binding '${input.conversation.ownerId}' was not found for conversation recovery.`,
      );
    }

    if (integrationBinding.sandboxProfileId !== input.conversation.sandboxProfileId) {
      throw new SandboxConversationsConflictError(
        SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
        `Conversation '${input.conversation.id}' has mismatched sandbox profile metadata.`,
      );
    }

    return {
      profileId: integrationBinding.sandboxProfileId,
      profileVersion: integrationBinding.sandboxProfileVersion,
    };
  }

  if (input.conversation.ownerKind === ConversationOwnerKinds.AUTOMATION_TARGET) {
    const automationTarget = await input.deps.db.query.automationTargets.findFirst({
      columns: {
        sandboxProfileId: true,
        sandboxProfileVersion: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, input.conversation.ownerId),
    });

    if (automationTarget === undefined) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.AUTOMATION_TARGET_NOT_FOUND,
        `Automation target '${input.conversation.ownerId}' was not found for conversation recovery.`,
      );
    }

    if (automationTarget.sandboxProfileVersion === null) {
      throw new SandboxConversationsBadRequestError(
        SandboxConversationsBadRequestCodes.AUTOMATION_TARGET_PROFILE_VERSION_MISSING,
        `Automation target '${input.conversation.ownerId}' is missing sandbox profile version metadata for conversation recovery.`,
      );
    }

    if (automationTarget.sandboxProfileId !== input.conversation.sandboxProfileId) {
      throw new SandboxConversationsConflictError(
        SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
        `Conversation '${input.conversation.id}' has mismatched sandbox profile metadata.`,
      );
    }

    return {
      profileId: automationTarget.sandboxProfileId,
      profileVersion: automationTarget.sandboxProfileVersion,
    };
  }

  throw new SandboxConversationsBadRequestError(
    SandboxConversationsBadRequestCodes.CONVERSATION_OWNER_UNSUPPORTED,
    `Conversation '${input.conversation.id}' has unsupported owner kind '${input.conversation.ownerKind}'.`,
  );
}

async function ensureRouteContinuity(input: {
  deps: CreateSandboxConversationsServiceInput;
  organizationId: string;
  userId: string;
  conversation: {
    id: string;
    ownerKind: string;
    ownerId: string;
    sandboxProfileId: string;
  };
  route: {
    id: string;
    sandboxInstanceId: string;
  };
}): Promise<RouteContinuityResult> {
  let sandboxStatus: "starting" | "running" | "stopped" | "failed" | "missing";
  try {
    const sandboxInstance = await input.deps.sandboxInstances.getInstance({
      organizationId: input.organizationId,
      instanceId: input.route.sandboxInstanceId,
    });
    sandboxStatus = sandboxInstance.status;
  } catch (error) {
    if (
      error instanceof SandboxInstancesNotFoundError &&
      error.code === SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND
    ) {
      sandboxStatus = "missing";
    } else {
      throw error;
    }
  }

  if (sandboxStatus === "running" || sandboxStatus === "starting") {
    return {
      routeId: input.route.id,
      sandboxInstanceId: input.route.sandboxInstanceId,
      workflowRunId: null,
    };
  }

  const resolvedProfile = await resolveConversationProfile({
    deps: input.deps,
    conversation: input.conversation,
  });

  if (sandboxStatus === "stopped") {
    try {
      const resumedSandbox = await input.deps.sandboxProfiles.startProfileInstance({
        organizationId: input.organizationId,
        profileId: resolvedProfile.profileId,
        profileVersion: resolvedProfile.profileVersion,
        startedBy: {
          kind: "user",
          id: input.userId,
        },
        source: "dashboard",
        restoreFromSourceInstanceId: input.route.sandboxInstanceId,
        sandboxInstanceId: input.route.sandboxInstanceId,
        image: createStartImage(input.deps.defaultBaseImage),
      });

      if (resumedSandbox.sandboxInstanceId !== input.route.sandboxInstanceId) {
        throw new SandboxConversationsConflictError(
          SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
          `Conversation '${input.conversation.id}' resumed to unexpected sandbox instance '${resumedSandbox.sandboxInstanceId}'.`,
        );
      }

      return {
        routeId: input.route.id,
        sandboxInstanceId: resumedSandbox.sandboxInstanceId,
        workflowRunId: resumedSandbox.workflowRunId,
      };
    } catch (error) {
      rethrowStartProfileError(error);
    }
  }

  if (sandboxStatus === "failed" || sandboxStatus === "missing") {
    let restoredSandbox: {
      workflowRunId: string;
      sandboxInstanceId: string;
    };

    try {
      restoredSandbox = await input.deps.sandboxProfiles.startProfileInstance({
        organizationId: input.organizationId,
        profileId: resolvedProfile.profileId,
        profileVersion: resolvedProfile.profileVersion,
        startedBy: {
          kind: "user",
          id: input.userId,
        },
        source: "dashboard",
        restoreFromSourceInstanceId: input.route.sandboxInstanceId,
        image: createStartImage(input.deps.defaultBaseImage),
      });
    } catch (error) {
      rethrowStartProfileError(error);
    }

    const updatedRoutes = await input.deps.db
      .update(conversationRoutes)
      .set({
        sandboxInstanceId: restoredSandbox.sandboxInstanceId,
        providerExecutionId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationRoutes.id, input.route.id))
      .returning({
        id: conversationRoutes.id,
        sandboxInstanceId: conversationRoutes.sandboxInstanceId,
      });

    const updatedRoute = updatedRoutes[0];
    if (updatedRoute === undefined) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.CONVERSATION_ROUTE_NOT_FOUND,
        `Conversation route '${input.route.id}' was not found during sandbox rebind.`,
      );
    }

    return {
      routeId: updatedRoute.id,
      sandboxInstanceId: updatedRoute.sandboxInstanceId,
      workflowRunId: restoredSandbox.workflowRunId,
    };
  }

  throw new SandboxConversationsConflictError(
    SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
    `Conversation '${input.conversation.id}' sandbox recovery failed due to unsupported lifecycle state.`,
  );
}

export async function startConversationSession(
  deps: CreateSandboxConversationsServiceInput,
  input: {
    organizationId: string;
    userId: string;
    profileId: string;
    profileVersion: number;
    integrationBindingId: string;
  },
): Promise<StartConversationSessionResult> {
  const profile = await deps.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.profileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });
  if (profile === undefined) {
    throw new SandboxConversationsNotFoundError(
      SandboxConversationsNotFoundCodes.PROFILE_NOT_FOUND,
      `Sandbox profile '${input.profileId}' was not found.`,
    );
  }

  const profileVersion = await deps.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
      version: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.profileId),
        whereEq(table.version, input.profileVersion),
      ),
  });
  if (profileVersion === undefined) {
    throw new SandboxConversationsNotFoundError(
      SandboxConversationsNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      `Sandbox profile '${input.profileId}' version '${String(input.profileVersion)}' was not found.`,
    );
  }

  const integrationBinding = await deps.db.query.sandboxProfileVersionIntegrationBindings.findFirst(
    {
      columns: {
        sandboxProfileId: true,
        sandboxProfileVersion: true,
        connectionId: true,
        kind: true,
        config: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, input.integrationBindingId),
    },
  );
  if (integrationBinding === undefined) {
    throw new SandboxConversationsNotFoundError(
      SandboxConversationsNotFoundCodes.INTEGRATION_BINDING_NOT_FOUND,
      `Integration binding '${input.integrationBindingId}' was not found.`,
    );
  }

  if (
    integrationBinding.sandboxProfileId !== input.profileId ||
    integrationBinding.sandboxProfileVersion !== input.profileVersion
  ) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_PROFILE_MISMATCH,
      `Integration binding '${input.integrationBindingId}' does not belong to sandbox profile '${input.profileId}' version '${String(input.profileVersion)}'.`,
    );
  }

  if (integrationBinding.kind !== IntegrationBindingKinds.AGENT) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
      `Integration binding '${input.integrationBindingId}' must be an agent binding.`,
    );
  }

  const bindingConnection = await deps.db.query.integrationConnections.findFirst({
    columns: {
      organizationId: true,
      targetKey: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, integrationBinding.connectionId),
  });
  if (bindingConnection === undefined) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
      `Integration binding '${input.integrationBindingId}' references missing connection '${integrationBinding.connectionId}'.`,
    );
  }

  if (bindingConnection.organizationId !== input.organizationId) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
      `Integration binding '${input.integrationBindingId}' references a connection outside the active organization.`,
    );
  }

  const bindingTarget = await deps.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, bindingConnection.targetKey),
  });
  if (bindingTarget === undefined) {
    throw new SandboxConversationsBadRequestError(
      SandboxConversationsBadRequestCodes.INTEGRATION_BINDING_INVALID,
      `Integration binding '${input.integrationBindingId}' references missing target '${bindingConnection.targetKey}'.`,
    );
  }

  const providerFamily = resolveProviderFamilyFromTargetFamily(bindingTarget.familyId);
  const providerModel = resolveProviderModelFromBindingConfig(integrationBinding.config);

  const conversationId = typeid("cnv").toString();
  await deps.db.insert(conversations).values({
    id: conversationId,
    organizationId: input.organizationId,
    ownerKind: ConversationOwnerKinds.INTEGRATION_BINDING,
    ownerId: input.integrationBindingId,
    createdByKind: ConversationCreatedByKinds.USER,
    createdById: input.userId,
    sandboxProfileId: input.profileId,
    providerFamily,
    conversationKey: conversationId,
    title: null,
    preview: null,
    status: ConversationStatuses.PENDING,
  });

  let startedSandbox: {
    workflowRunId: string;
    sandboxInstanceId: string;
  };
  try {
    startedSandbox = await deps.sandboxProfiles.startProfileInstance({
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      startedBy: {
        kind: "user",
        id: input.userId,
      },
      source: "dashboard",
      image: createStartImage(deps.defaultBaseImage),
    });
  } catch (error) {
    rethrowStartProfileError(error);
  }

  const createdRouteRows = await deps.db
    .insert(conversationRoutes)
    .values({
      conversationId,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      providerConversationId: null,
      providerExecutionId: null,
      providerState: null,
      status: ConversationRouteStatuses.ACTIVE,
    })
    .returning({
      id: conversationRoutes.id,
    });

  const createdRoute = createdRouteRows[0];
  if (createdRoute === undefined) {
    throw new SandboxConversationsNotFoundError(
      SandboxConversationsNotFoundCodes.CONVERSATION_ROUTE_NOT_FOUND,
      `Conversation route was not created for conversation '${conversationId}'.`,
    );
  }

  try {
    await waitForSandboxInstanceRunning({
      deps,
      organizationId: input.organizationId,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
    });
  } catch (error) {
    if (error instanceof SandboxInstancesNotFoundError) {
      throw new SandboxConversationsConflictError(
        SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
        `Sandbox instance '${startedSandbox.sandboxInstanceId}' was not found while activating the conversation route.`,
      );
    }
    throw error;
  }

  let providerConversationId: string;
  try {
    const mintedConnection = await deps.sandboxInstances.mintConnectionToken({
      organizationId: input.organizationId,
      instanceId: startedSandbox.sandboxInstanceId,
    });
    providerConversationId = await createCodexProviderConversation({
      connectionUrl: mintedConnection.url,
      model: providerModel,
    });
  } catch (error) {
    if (
      error instanceof SandboxInstancesNotFoundError ||
      error instanceof SandboxInstancesConflictError
    ) {
      throw new SandboxConversationsConflictError(
        SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
        `Sandbox instance '${startedSandbox.sandboxInstanceId}' was unavailable during conversation activation.`,
      );
    }
    throw error;
  }

  await deps.db.transaction(async (tx) => {
    const updatedConversations = await tx
      .update(conversations)
      .set({
        status: ConversationStatuses.ACTIVE,
        updatedAt: sql`now()`,
        lastActivityAt: sql`now()`,
      })
      .where(eq(conversations.id, conversationId))
      .returning({
        id: conversations.id,
      });

    if (updatedConversations[0] === undefined) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.CONVERSATION_NOT_FOUND,
        `Conversation '${conversationId}' was not found during activation.`,
      );
    }

    const updatedRoutes = await tx
      .update(conversationRoutes)
      .set({
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        providerConversationId,
        providerExecutionId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationRoutes.id, createdRoute.id))
      .returning({
        id: conversationRoutes.id,
      });

    if (updatedRoutes[0] === undefined) {
      throw new SandboxConversationsNotFoundError(
        SandboxConversationsNotFoundCodes.CONVERSATION_ROUTE_NOT_FOUND,
        `Conversation route '${createdRoute.id}' was not found during activation.`,
      );
    }
  });

  return {
    conversationId,
    routeId: createdRoute.id,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
    workflowRunId: startedSandbox.workflowRunId,
  };
}

export async function continueConversationSession(
  deps: CreateSandboxConversationsServiceInput,
  input: {
    organizationId: string;
    userId: string;
    conversationId: string;
  },
): Promise<StartConversationSessionResult> {
  const conversation = await deps.db.query.conversations.findFirst({
    columns: {
      id: true,
      ownerKind: true,
      ownerId: true,
      sandboxProfileId: true,
      status: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.conversationId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (conversation === undefined) {
    throw new SandboxConversationsNotFoundError(
      SandboxConversationsNotFoundCodes.CONVERSATION_NOT_FOUND,
      `Conversation '${input.conversationId}' was not found.`,
    );
  }

  if (conversation.status === ConversationStatuses.CLOSED) {
    throw new SandboxConversationsConflictError(
      SandboxConversationsConflictCodes.CONVERSATION_CLOSED,
      `Conversation '${input.conversationId}' is closed and cannot be continued.`,
    );
  }

  const route = await deps.db.query.conversationRoutes.findFirst({
    columns: {
      id: true,
      sandboxInstanceId: true,
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.conversationId, input.conversationId),
  });

  if (route === undefined) {
    throw new SandboxConversationsNotFoundError(
      SandboxConversationsNotFoundCodes.CONVERSATION_ROUTE_NOT_FOUND,
      `Conversation route for '${input.conversationId}' was not found.`,
    );
  }

  if (route.status === ConversationRouteStatuses.CLOSED) {
    throw new SandboxConversationsConflictError(
      SandboxConversationsConflictCodes.CONVERSATION_ROUTE_CLOSED,
      `Conversation route '${route.id}' is closed and cannot be continued.`,
    );
  }

  const continuity = await ensureRouteContinuity({
    deps,
    organizationId: input.organizationId,
    userId: input.userId,
    conversation,
    route,
  });

  await deps.db
    .update(conversations)
    .set({
      lastActivityAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.status, ConversationStatuses.ACTIVE),
      ),
    );

  return {
    conversationId: input.conversationId,
    routeId: continuity.routeId,
    sandboxInstanceId: continuity.sandboxInstanceId,
    workflowRunId: continuity.workflowRunId,
  };
}
