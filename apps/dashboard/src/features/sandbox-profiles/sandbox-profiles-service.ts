import { z } from "zod";

import { getControlPlaneApiClient } from "../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "./sandbox-profiles-api-errors.js";
import type {
  CreateSandboxProfileInput,
  DeleteSandboxProfileResult,
  DeleteSandboxProfileVersionRefreshScheduleResult,
  DuplicateSandboxProfileInput,
  DuplicateSandboxProfileResult,
  LaunchableSandboxProfilesResult,
  PutSandboxProfileVersionDraftInput,
  PutSandboxProfileVersionDraftResult,
  PutSandboxProfileVersionRefreshScheduleInput,
  RefreshSandboxProfileVersionSkillsSourceRepoInput,
  RefreshSandboxProfileVersionSkillsSourceRepoResult,
  SandboxProfile,
  SandboxProfileVersion,
  SandboxProfileVersionDraftTriggerImpact,
  SandboxProfileVersionPublishability,
  SandboxProfileVersionIntegrationBinding,
  SandboxProfileVersionTriggerConfig,
  SandboxProfileVersionRefreshSchedule,
  SandboxProfileVersionSkillsSourceReposResult,
  SandboxProfileVersionSetupScript,
  SandboxProfileSetupScriptTestRuntimeConfig,
  SandboxProvidersResult,
  SandboxProfileSetupAssistant,
  SandboxProfileMaintenanceScriptTestRun,
  SandboxProfileSetupScriptTestRun,
  SandboxProfilesListResult,
  PublishSandboxProfileVersionResult,
  UpdateSandboxProfileInput,
} from "./sandbox-profiles-types.js";

const AgentRuntimeIdSchema = z.enum(["codex", "opencode", "pi"]);

const LaunchableSandboxProfilesResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          activeVersion: z.number().int().min(1).nullable(),
          id: z.string().min(1),
          organizationId: z.string().min(1),
          displayName: z.string().min(1),
          status: z.enum(["active", "inactive"]),
          latestVersion: z.number().int().min(1),
          createdAt: z.string().min(1),
          updatedAt: z.string().min(1),
          repositoryOptions: z.array(
            z
              .object({
                id: z.string().min(1),
                label: z.string().min(1),
                path: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

const SandboxProfileVersionDraftTriggerImpactSchema = z
  .object({
    hasBreakingChanges: z.boolean(),
    affectedTriggers: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          kind: z.enum(["webhook", "schedule"]),
          enabled: z.boolean(),
          issues: z.array(
            z
              .object({
                code: z.enum([
                  "AGENT_BINDING_REQUIRED",
                  "AGENT_BINDING_AMBIGUOUS",
                  "INVALID_BINDING_CONNECTION_REFERENCE",
                  "CONNECTION_NOT_ACTIVE",
                  "TARGET_DISABLED",
                  "TARGET_MISSING",
                  "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
                  "PRIMARY_REPOSITORY_UNAVAILABLE",
                ]),
                message: z.string().min(1),
                bindingId: z.string().min(1).optional(),
                connectionId: z.string().min(1).optional(),
                targetKey: z.string().min(1).optional(),
                primaryRepositoryId: z.string().min(1).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
type ParsedSandboxProfileVersionDraftTriggerImpact = z.infer<
  typeof SandboxProfileVersionDraftTriggerImpactSchema
>;

export async function listSandboxProfiles(input: {
  limit: number;
  after: string | null;
  before: string | null;
  signal?: AbortSignal;
}): Promise<SandboxProfilesListResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/sandbox/profiles", {
      credentials: "include",
      params: {
        query: {
          limit: input.limit,
          ...(input.after === null ? {} : { after: input.after }),
          ...(input.before === null ? {} : { before: input.before }),
        },
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "listSandboxProfiles",
        status: 500,
        body: null,
        message: "Sandbox profiles list response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listSandboxProfiles",
        error,
        fallbackMessage: "Could not load sandbox profiles.",
      }),
    );
  }
}

export async function listLaunchableSandboxProfiles(input: {
  signal?: AbortSignal;
}): Promise<LaunchableSandboxProfilesResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/sandbox/profiles/launchable", {
      credentials: "include",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "listLaunchableSandboxProfiles",
        status: 500,
        body: null,
        message: "Launchable sandbox profiles response was empty.",
        code: null,
      });
    }

    return LaunchableSandboxProfilesResultSchema.parse(data);
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listLaunchableSandboxProfiles",
        error,
        fallbackMessage: "Could not load launchable sandbox profiles.",
      }),
    );
  }
}

export async function listSandboxProviders(input?: {
  signal?: AbortSignal;
}): Promise<SandboxProvidersResult> {
  try {
    const response = await requestControlPlane({
      operation: "listSandboxProviders",
      method: "GET",
      pathname: "/v1/sandbox/providers",
      fallbackMessage: "Could not load sandbox providers.",
      ...(input?.signal === undefined ? {} : { signal: input.signal }),
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProvidersResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "listSandboxProviders",
        status: 500,
        body: responseBody,
        message: "Sandbox providers response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listSandboxProviders",
        error,
        fallbackMessage: "Could not load sandbox providers.",
      }),
    );
  }
}

export async function getSandboxProfile(input: {
  profileId: string;
  signal?: AbortSignal;
}): Promise<SandboxProfile> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/sandbox/profiles/{profileId}", {
      credentials: "include",
      params: {
        path: {
          profileId: input.profileId,
        },
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfile",
        status: 500,
        body: null,
        message: "Sandbox profile response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfile",
        error,
        fallbackMessage: "Could not load sandbox profile.",
      }),
    );
  }
}

export async function createSandboxProfile(input: {
  payload: CreateSandboxProfileInput;
}): Promise<SandboxProfile> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.POST("/v1/sandbox/profiles", {
      credentials: "include",
      body: input.payload,
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "createSandboxProfile",
        status: 500,
        body: null,
        message: "Create sandbox profile response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "createSandboxProfile",
        error,
        fallbackMessage: "Could not create sandbox profile.",
      }),
    );
  }
}

export async function duplicateSandboxProfile(input: {
  payload: DuplicateSandboxProfileInput;
}): Promise<DuplicateSandboxProfileResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.POST("/v1/sandbox/profiles/{profileId}/duplicate", {
      credentials: "include",
      params: {
        path: {
          profileId: input.payload.profileId,
        },
      },
      body: {
        displayName: input.payload.displayName,
        ...(input.payload.includeTriggers === undefined
          ? {}
          : { includeTriggers: input.payload.includeTriggers }),
      },
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "duplicateSandboxProfile",
        status: 500,
        body: null,
        message: "Duplicate sandbox profile response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "duplicateSandboxProfile",
        error,
        fallbackMessage: "Could not duplicate sandbox profile.",
      }),
    );
  }
}

export async function updateSandboxProfile(input: {
  payload: UpdateSandboxProfileInput;
}): Promise<SandboxProfile> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.PATCH("/v1/sandbox/profiles/{profileId}", {
      credentials: "include",
      params: {
        path: {
          profileId: input.payload.profileId,
        },
      },
      body: {
        ...(input.payload.displayName === undefined
          ? {}
          : { displayName: input.payload.displayName }),
      },
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "updateSandboxProfile",
        status: 500,
        body: null,
        message: "Update sandbox profile response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "updateSandboxProfile",
        error,
        fallbackMessage: "Could not update sandbox profile.",
      }),
    );
  }
}

export async function deleteSandboxProfile(input: {
  profileId: string;
}): Promise<DeleteSandboxProfileResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.DELETE("/v1/sandbox/profiles/{profileId}", {
      credentials: "include",
      params: {
        path: {
          profileId: input.profileId,
        },
      },
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "deleteSandboxProfile",
        status: 500,
        body: null,
        message: "Delete sandbox profile response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "deleteSandboxProfile",
        error,
        fallbackMessage: "Could not delete sandbox profile.",
      }),
    );
  }
}

const SandboxProfileVersionRefreshScheduleSummarySchema = z
  .object({
    scheduleId: z.string().min(1),
    name: z.string().min(1),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    enabled: z.boolean(),
    nextScheduledAt: z.string().min(1).nullable(),
  })
  .strict();

const SandboxProfileVersionResourcesSchema = z
  .object({
    vcpuCount: z.number().int().min(1),
    memoryMb: z.number().int().min(1),
    diskMb: z.number().int().min(1).optional(),
  })
  .strict()
  .transform((value) => ({
    vcpuCount: value.vcpuCount,
    memoryMb: value.memoryMb,
    ...(value.diskMb === undefined ? {} : { diskMb: value.diskMb }),
  }));

const RepoRelativeSkillPathPattern =
  /^(?:\.|(?=.*\S)(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/).+)$/;

const RepoRelativeSkillPathSchema = z.string().regex(RepoRelativeSkillPathPattern, {
  message: "Skill relativePath must be a repo-relative path.",
});
const SandboxProfileVersionSkillsConfigSchema = z
  .object({
    originUrl: z.url(),
    selectedSkills: z.array(
      z
        .object({
          name: z.string().min(1),
          relativePath: RepoRelativeSkillPathSchema,
        })
        .strict(),
    ),
  })
  .strict();

const SandboxRuntimeResourceCapabilitySchema = z
  .object({
    default: z.number().int().min(0),
    max: z.number().int().min(0),
    min: z.number().int().min(0),
    step: z.number().int().min(1),
  })
  .strict();

const SandboxRuntimeMemoryResourceCapabilitySchema = SandboxRuntimeResourceCapabilitySchema.extend({
  maxPerVcpu: z.number().int().min(0).optional(),
  minPerVcpu: z.number().int().min(0).optional(),
}).transform((capability) => ({
  default: capability.default,
  max: capability.max,
  ...(capability.maxPerVcpu === undefined ? {} : { maxPerVcpu: capability.maxPerVcpu }),
  min: capability.min,
  ...(capability.minPerVcpu === undefined ? {} : { minPerVcpu: capability.minPerVcpu }),
  step: capability.step,
}));

const SandboxRuntimeResourceCapabilitiesSchema = z
  .object({
    memoryMb: SandboxRuntimeMemoryResourceCapabilitySchema,
    diskMb: SandboxRuntimeResourceCapabilitySchema.optional(),
    vcpuCount: SandboxRuntimeResourceCapabilitySchema,
  })
  .strict()
  .transform((capabilities) => ({
    memoryMb: capabilities.memoryMb,
    ...(capabilities.diskMb === undefined ? {} : { diskMb: capabilities.diskMb }),
    vcpuCount: capabilities.vcpuCount,
  }));

const SandboxProvidersResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          displayName: z.string().min(1),
          id: z.string().min(1),
          managed: z.boolean(),
          resourceCapabilities: SandboxRuntimeResourceCapabilitiesSchema.nullable(),
          supportsOrganizationConnection: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const SandboxProfileVersionSchema = z
  .object({
    agentRuntimeId: AgentRuntimeIdSchema,
    isActive: z.boolean(),
    latestSnapshotJob: z
      .object({
        id: z.string().min(1),
        sandboxInstanceId: z.string().min(1).nullable(),
        trigger: z.enum(["publish", "manual_refresh", "scheduled_refresh"]),
        state: z.enum(["queued", "running", "succeeded", "failed"]),
        errorCode: z.string().min(1).nullable(),
        errorMessage: z.string().min(1).nullable(),
        createdAt: z.string().min(1),
        startedAt: z.string().min(1).nullable(),
        finishedAt: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
    refreshSchedule: SandboxProfileVersionRefreshScheduleSummarySchema.nullable(),
    maintenanceScript: z.string().nullable(),
    gitCommitSigningIntegrationConnectionId: z.string().min(1).nullable(),
    mistleMcpEnabled: z.boolean(),
    mistleMcpApiKeyId: z.string().min(1).nullable(),
    sandboxConnectionId: z.string().min(1).nullable(),
    sandboxProfileId: z.string().min(1),
    sandboxProvider: z.string().min(1).nullable(),
    sandboxResources: SandboxProfileVersionResourcesSchema.nullable(),
    skillsConfig: SandboxProfileVersionSkillsConfigSchema.nullable(),
    state: z.enum(["draft", "published"]),
    publishedAt: z.string().min(1).nullable(),
    usable: z.boolean(),
    version: z.number().int().min(1),
  })
  .strict();

const ListSandboxProfileVersionsResponseSchema = z
  .object({
    versions: z.array(SandboxProfileVersionSchema),
  })
  .strict();

const SandboxProfileVersionPublishabilitySchema = z
  .object({
    publishable: z.boolean(),
    issues: z.array(
      z
        .object({
          code: z.enum([
            "PROFILE_VERSION_NOT_DRAFT",
            "AGENT_BINDING_REQUIRED",
            "INVALID_BINDING_CONNECTION_REFERENCE",
            "CONNECTION_NOT_ACTIVE",
            "TARGET_DISABLED",
            "SANDBOX_PROVIDER_REQUIRED",
            "INVALID_SANDBOX_PROVIDER",
            "SANDBOX_MANAGED_PROVIDER_UNAVAILABLE",
            "INVALID_SANDBOX_CONNECTION_REFERENCE",
            "SANDBOX_CONNECTION_NOT_ACTIVE",
            "SANDBOX_CONNECTION_KIND_MISMATCH",
            "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
            "INVALID_SANDBOX_RESOURCES",
            "SKILLS_SOURCE_NOT_LOADED",
            "SKILLS_SOURCE_NOT_BOUND",
            "SELECTED_SKILLS_NOT_FOUND",
          ]),
          message: z.string().min(1),
          bindingId: z.string().min(1).optional(),
          connectionId: z.string().min(1).optional(),
          targetKey: z.string().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

const PublishSandboxProfileVersionResultSchema = z
  .object({
    activeVersion: z.number().int().min(1).nullable(),
    snapshotJob: z
      .object({
        id: z.string().min(1),
        sandboxInstanceId: z.string().min(1).nullable(),
        trigger: z.enum(["publish", "manual_refresh", "scheduled_refresh"]),
        state: z.enum(["queued", "running", "succeeded", "failed"]),
        errorCode: z.string().min(1).nullable(),
        errorMessage: z.string().min(1).nullable(),
        createdAt: z.string().min(1),
        startedAt: z.string().min(1).nullable(),
        finishedAt: z.string().min(1).nullable(),
      })
      .strict(),
    version: SandboxProfileVersionSchema,
  })
  .strict();

const DiscardSandboxProfileVersionDraftResultSchema = z
  .object({
    discardedVersion: z.number().int().min(1),
    hasDraft: z.boolean(),
  })
  .strict();

const SandboxProfileVersionRefreshScheduleResponseSchema =
  SandboxProfileVersionRefreshScheduleSummarySchema.extend({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
  }).strict();

const DeleteSandboxProfileVersionRefreshScheduleResultSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    deleted: z.boolean(),
  })
  .strict();

function normalizeSandboxProfileVersionPublishability(
  input: z.infer<typeof SandboxProfileVersionPublishabilitySchema>,
): SandboxProfileVersionPublishability {
  const issues: SandboxProfileVersionPublishability["issues"] = input.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ...(issue.bindingId === undefined ? {} : { bindingId: issue.bindingId }),
    ...(issue.connectionId === undefined ? {} : { connectionId: issue.connectionId }),
    ...(issue.targetKey === undefined ? {} : { targetKey: issue.targetKey }),
  }));

  return {
    publishable: input.publishable,
    issues,
  };
}

const IntegrationBindingKindSchema = z.enum(["agent", "git", "connector", "sandbox"]);

const SandboxProfileVersionIntegrationBindingSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    connectionId: z.string().min(1),
    kind: IntegrationBindingKindSchema,
    config: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const SandboxProfileVersionIntegrationBindingsResponseSchema = z
  .object({
    bindings: z.array(SandboxProfileVersionIntegrationBindingSchema),
  })
  .strict();

const SandboxProfileVersionSkillsSourceRepoSchema = z
  .object({
    id: z.string().min(1),
    originUrl: z.url(),
    commitSha: z.string().min(1).nullable(),
    skills: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string(),
          relativePath: z.string().min(1),
        })
        .strict(),
    ),
    lastSyncedAt: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const SandboxProfileVersionSkillsSourceReposResponseSchema = z
  .object({
    items: z.array(SandboxProfileVersionSkillsSourceRepoSchema),
  })
  .strict();

const RefreshSandboxProfileVersionSkillsSourceRepoResultSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
    skillsSourceRepo: SandboxProfileVersionSkillsSourceRepoSchema,
  })
  .strict();

const PutSandboxProfileVersionDraftResultSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    setupScript: z.string().nullable(),
    agentRuntimeId: AgentRuntimeIdSchema,
    gitCommitSigningIntegrationConnectionId: z.string().min(1).nullable(),
    mistleMcpEnabled: z.boolean(),
    mistleMcpApiKeyId: z.string().min(1).nullable(),
    sandboxConnectionId: z.string().min(1).nullable(),
    sandboxProvider: z.string().min(1).nullable(),
    sandboxResources: SandboxProfileVersionResourcesSchema.nullable(),
    skillsConfig: SandboxProfileVersionSkillsConfigSchema.nullable(),
    integrationBindings: SandboxProfileVersionIntegrationBindingsResponseSchema,
  })
  .strict();

const SandboxProfileRepositoryOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

const SandboxProfileVersionTriggerConfigResponseSchema = z
  .object({
    bindings: z.array(SandboxProfileVersionIntegrationBindingSchema),
    repositoryOptions: z.array(SandboxProfileRepositoryOptionSchema),
  })
  .strict();

const SandboxProfileVersionSetupScriptResponseSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    setupScript: z.string().nullable(),
  })
  .strict();

const SandboxProfileAcceptedStartResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

const SandboxProfileSetupScriptTestRunResponseSchema = SandboxProfileAcceptedStartResponseSchema;
const SandboxProfileMaintenanceScriptTestRunResponseSchema =
  SandboxProfileAcceptedStartResponseSchema;
const SandboxProfileSetupAssistantResponseSchema = SandboxProfileAcceptedStartResponseSchema;

export async function listSandboxProfileVersions(input: {
  profileId: string;
  signal?: AbortSignal;
}): Promise<{ versions: SandboxProfileVersion[] }> {
  try {
    const response = await requestControlPlane({
      operation: "listSandboxProfileVersions",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile versions.",
    });

    const responseBody = await response.json();
    const parsedResponse = ListSandboxProfileVersionsResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "listSandboxProfileVersions",
        status: 500,
        body: responseBody,
        message: "Sandbox profile versions response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listSandboxProfileVersions",
        error,
        fallbackMessage: "Could not load sandbox profile versions.",
      }),
    );
  }
}

export async function createSandboxProfileVersionDraft(input: {
  profileId: string;
}): Promise<SandboxProfileVersion> {
  try {
    const response = await requestControlPlane({
      operation: "createSandboxProfileVersionDraft",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions`,
      fallbackMessage: "Could not create sandbox profile draft.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileVersionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "createSandboxProfileVersionDraft",
        status: 500,
        body: responseBody,
        message: "Sandbox profile version response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "createSandboxProfileVersionDraft",
        error,
        fallbackMessage: "Could not create sandbox profile draft.",
      }),
    );
  }
}

export async function getSandboxProfileVersionPublishability(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<SandboxProfileVersionPublishability> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxProfileVersionPublishability",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/publishability`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile publishability.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileVersionPublishabilitySchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfileVersionPublishability",
        status: 500,
        body: responseBody,
        message: "Sandbox profile publishability response payload is invalid.",
      });
    }

    return normalizeSandboxProfileVersionPublishability(parsedResponse.data);
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfileVersionPublishability",
        error,
        fallbackMessage: "Could not load sandbox profile publishability.",
      }),
    );
  }
}

export async function getSandboxProfileVersionDraftTriggerImpact(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<SandboxProfileVersionDraftTriggerImpact> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxProfileVersionDraftTriggerImpact",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/draft-trigger-impact`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not check draft trigger impact.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileVersionDraftTriggerImpactSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfileVersionDraftTriggerImpact",
        status: 500,
        body: responseBody,
        message: "Sandbox profile draft trigger impact response payload is invalid.",
      });
    }

    return normalizeSandboxProfileVersionDraftTriggerImpact(parsedResponse.data);
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfileVersionDraftTriggerImpact",
        error,
        fallbackMessage: "Could not check draft trigger impact.",
      }),
    );
  }
}

function normalizeSandboxProfileVersionDraftTriggerImpact(
  input: ParsedSandboxProfileVersionDraftTriggerImpact,
): SandboxProfileVersionDraftTriggerImpact {
  return {
    hasBreakingChanges: input.hasBreakingChanges,
    affectedTriggers: input.affectedTriggers.map((trigger) => ({
      enabled: trigger.enabled,
      id: trigger.id,
      issues: trigger.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...(issue.bindingId === undefined ? {} : { bindingId: issue.bindingId }),
        ...(issue.connectionId === undefined ? {} : { connectionId: issue.connectionId }),
        ...(issue.targetKey === undefined ? {} : { targetKey: issue.targetKey }),
        ...(issue.primaryRepositoryId === undefined
          ? {}
          : { primaryRepositoryId: issue.primaryRepositoryId }),
      })),
      kind: trigger.kind,
      name: trigger.name,
    })),
  };
}

export async function publishSandboxProfileVersion(input: {
  profileId: string;
  version: number;
}): Promise<PublishSandboxProfileVersionResult> {
  try {
    const response = await requestControlPlane({
      operation: "publishSandboxProfileVersion",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/publish`,
      fallbackMessage: "Could not publish sandbox profile version.",
    });

    const responseBody = await response.json();
    const parsedResponse = PublishSandboxProfileVersionResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "publishSandboxProfileVersion",
        status: 500,
        body: responseBody,
        message: "Publish sandbox profile version response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "publishSandboxProfileVersion",
        error,
        fallbackMessage: "Could not publish sandbox profile version.",
      }),
    );
  }
}

export async function refreshSandboxProfileVersion(input: {
  profileId: string;
  version: number;
  refreshKind: "setup" | "maintenance";
}): Promise<PublishSandboxProfileVersionResult> {
  try {
    const response = await requestControlPlane({
      operation: "refreshSandboxProfileVersion",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/refresh`,
      body: {
        refreshKind: input.refreshKind,
      },
      fallbackMessage: "Could not refresh sandbox profile snapshot.",
    });

    const responseBody = await response.json();
    const parsedResponse = PublishSandboxProfileVersionResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "refreshSandboxProfileVersion",
        status: 500,
        body: responseBody,
        message: "Refresh sandbox profile version response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "refreshSandboxProfileVersion",
        error,
        fallbackMessage: "Could not refresh sandbox profile snapshot.",
      }),
    );
  }
}

export async function retrySandboxProfileVersionPublishSnapshot(input: {
  profileId: string;
  version: number;
}): Promise<PublishSandboxProfileVersionResult> {
  try {
    const response = await requestControlPlane({
      operation: "retrySandboxProfileVersionPublishSnapshot",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/retry-publish-snapshot`,
      fallbackMessage: "Could not retry sandbox profile snapshot creation.",
    });

    const responseBody = await response.json();
    const parsedResponse = PublishSandboxProfileVersionResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "retrySandboxProfileVersionPublishSnapshot",
        status: 500,
        body: responseBody,
        message: "Retry sandbox profile publish snapshot response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "retrySandboxProfileVersionPublishSnapshot",
        error,
        fallbackMessage: "Could not retry sandbox profile snapshot creation.",
      }),
    );
  }
}

export async function putSandboxProfileVersionRefreshSchedule(
  input: PutSandboxProfileVersionRefreshScheduleInput,
): Promise<SandboxProfileVersionRefreshSchedule> {
  try {
    const response = await requestControlPlane({
      operation: "putSandboxProfileVersionRefreshSchedule",
      method: "PUT",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/refresh-schedule`,
      body: {
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        maintenanceScript: input.maintenanceScript,
        ...(input.name === undefined ? {} : { name: input.name }),
      },
      fallbackMessage: "Could not save sandbox profile snapshot refresh schedule.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SandboxProfileVersionRefreshScheduleResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "putSandboxProfileVersionRefreshSchedule",
        status: 500,
        body: responseBody,
        message: "Sandbox profile snapshot refresh schedule response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "putSandboxProfileVersionRefreshSchedule",
        error,
        fallbackMessage: "Could not save sandbox profile snapshot refresh schedule.",
      }),
    );
  }
}

export async function deleteSandboxProfileVersionRefreshSchedule(input: {
  profileId: string;
  version: number;
}): Promise<DeleteSandboxProfileVersionRefreshScheduleResult> {
  try {
    const response = await requestControlPlane({
      operation: "deleteSandboxProfileVersionRefreshSchedule",
      method: "DELETE",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/refresh-schedule`,
      fallbackMessage: "Could not remove sandbox profile snapshot refresh schedule.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      DeleteSandboxProfileVersionRefreshScheduleResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "deleteSandboxProfileVersionRefreshSchedule",
        status: 500,
        body: responseBody,
        message: "Delete sandbox profile snapshot refresh schedule response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "deleteSandboxProfileVersionRefreshSchedule",
        error,
        fallbackMessage: "Could not remove sandbox profile snapshot refresh schedule.",
      }),
    );
  }
}

export async function discardSandboxProfileVersionDraft(input: {
  profileId: string;
  version: number;
}): Promise<z.infer<typeof DiscardSandboxProfileVersionDraftResultSchema>> {
  try {
    const response = await requestControlPlane({
      operation: "discardSandboxProfileVersionDraft",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/discard`,
      fallbackMessage: "Could not discard sandbox profile draft.",
    });

    const responseBody = await response.json();
    const parsedResponse = DiscardSandboxProfileVersionDraftResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "discardSandboxProfileVersionDraft",
        status: 500,
        body: responseBody,
        message: "Discard sandbox profile draft response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "discardSandboxProfileVersionDraft",
        error,
        fallbackMessage: "Could not discard sandbox profile draft.",
      }),
    );
  }
}

export async function getSandboxProfileVersionIntegrationBindings(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<{ bindings: SandboxProfileVersionIntegrationBinding[] }> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxProfileVersionIntegrationBindings",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/integration-bindings`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile integration bindings.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SandboxProfileVersionIntegrationBindingsResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfileVersionIntegrationBindings",
        status: 500,
        body: responseBody,
        message: "Sandbox profile integration bindings response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfileVersionIntegrationBindings",
        error,
        fallbackMessage: "Could not load sandbox profile integration bindings.",
      }),
    );
  }
}

export async function listSandboxProfileVersionSkillsSourceRepos(input: {
  profileId: string;
  version: number;
  originUrl?: string;
  signal?: AbortSignal;
}): Promise<SandboxProfileVersionSkillsSourceReposResult> {
  try {
    const response = await requestControlPlane({
      operation: "listSandboxProfileVersionSkillsSourceRepos",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/skills-sources`,
      query: {
        originUrl: input.originUrl,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile skills.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SandboxProfileVersionSkillsSourceReposResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "listSandboxProfileVersionSkillsSourceRepos",
        status: 500,
        body: responseBody,
        message: "Sandbox profile skills response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listSandboxProfileVersionSkillsSourceRepos",
        error,
        fallbackMessage: "Could not load sandbox profile skills.",
      }),
    );
  }
}

export async function refreshSandboxProfileVersionSkillsSourceRepo(
  input: RefreshSandboxProfileVersionSkillsSourceRepoInput & {
    signal?: AbortSignal;
  },
): Promise<RefreshSandboxProfileVersionSkillsSourceRepoResult> {
  try {
    const response = await requestControlPlane({
      operation: "refreshSandboxProfileVersionSkillsSourceRepo",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/skills-sources/refresh`,
      body: {
        originUrl: input.originUrl,
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not refresh sandbox profile skills.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      RefreshSandboxProfileVersionSkillsSourceRepoResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "refreshSandboxProfileVersionSkillsSourceRepo",
        status: 500,
        body: responseBody,
        message: "Sandbox profile skills refresh response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "refreshSandboxProfileVersionSkillsSourceRepo",
        error,
        fallbackMessage: "Could not refresh sandbox profile skills.",
      }),
    );
  }
}

export async function getSandboxProfileVersionTriggerConfig(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<SandboxProfileVersionTriggerConfig> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxProfileVersionTriggerConfig",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/trigger-config`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile trigger config.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileVersionTriggerConfigResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfileVersionTriggerConfig",
        status: 500,
        body: responseBody,
        message: "Sandbox profile trigger config response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfileVersionTriggerConfig",
        error,
        fallbackMessage: "Could not load sandbox profile trigger config.",
      }),
    );
  }
}

export async function getSandboxProfileVersionSetupScript(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<SandboxProfileVersionSetupScript> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxProfileVersionSetupScript",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/setup-script`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile setup script.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileVersionSetupScriptResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfileVersionSetupScript",
        status: 500,
        body: responseBody,
        message: "Sandbox profile setup script response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfileVersionSetupScript",
        error,
        fallbackMessage: "Could not load sandbox profile setup script.",
      }),
    );
  }
}

export async function putSandboxProfileVersionDraft(
  input: PutSandboxProfileVersionDraftInput,
): Promise<PutSandboxProfileVersionDraftResult> {
  try {
    const response = await requestControlPlane({
      operation: "putSandboxProfileVersionDraft",
      method: "PUT",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/draft`,
      body: {
        ...(input.setupScript === undefined ? {} : { setupScript: input.setupScript }),
        ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
        ...(input.gitCommitSigningIntegrationConnectionId === undefined
          ? {}
          : {
              gitCommitSigningIntegrationConnectionId:
                input.gitCommitSigningIntegrationConnectionId,
            }),
        ...(input.mistleMcpEnabled === undefined
          ? {}
          : { mistleMcpEnabled: input.mistleMcpEnabled }),
        ...(input.mistleMcpApiKeyId === undefined
          ? {}
          : { mistleMcpApiKeyId: input.mistleMcpApiKeyId }),
        ...(input.sandboxProvider === undefined ? {} : { sandboxProvider: input.sandboxProvider }),
        ...(input.sandboxConnectionId === undefined
          ? {}
          : { sandboxConnectionId: input.sandboxConnectionId }),
        ...(input.sandboxResources === undefined
          ? {}
          : { sandboxResources: input.sandboxResources }),
        ...(input.skillsConfig === undefined ? {} : { skillsConfig: input.skillsConfig }),
        ...(input.integrationBindings === undefined
          ? {}
          : { integrationBindings: input.integrationBindings }),
      },
      fallbackMessage: "Could not save sandbox profile draft.",
    });

    const responseBody = await response.json();
    const parsedResponse = PutSandboxProfileVersionDraftResultSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "putSandboxProfileVersionDraft",
        status: 500,
        body: responseBody,
        message: "Sandbox profile draft response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "putSandboxProfileVersionDraft",
        error,
        fallbackMessage: "Could not save sandbox profile draft.",
      }),
    );
  }
}

export async function startSandboxProfileSetupScriptTestRun(input: {
  profileId: string;
  version: number;
  setupScript: string;
  runtimeConfig?: SandboxProfileSetupScriptTestRuntimeConfig;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<SandboxProfileSetupScriptTestRun> {
  try {
    const response = await requestControlPlane({
      operation: "startSandboxProfileSetupScriptTestRun",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/setup-script/test-runs`,
      body: {
        setupScript: input.setupScript,
        ...(input.runtimeConfig === undefined
          ? {}
          : {
              agentRuntimeId: input.runtimeConfig.agentRuntimeId,
              ...(input.runtimeConfig.sandboxProvider === null
                ? {}
                : { sandboxProvider: input.runtimeConfig.sandboxProvider }),
              sandboxConnectionId: input.runtimeConfig.sandboxConnectionId,
              sandboxResources: input.runtimeConfig.sandboxResources,
            }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start setup script test run.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileSetupScriptTestRunResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "startSandboxProfileSetupScriptTestRun",
        status: 500,
        body: responseBody,
        message: "Setup script test run response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "startSandboxProfileSetupScriptTestRun",
        error,
        fallbackMessage: "Could not start setup script test run.",
      }),
    );
  }
}

export async function startSandboxProfileMaintenanceScriptTestRun(input: {
  profileId: string;
  version: number;
  maintenanceScript: string;
  runtimeConfig?: SandboxProfileSetupScriptTestRuntimeConfig;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<SandboxProfileMaintenanceScriptTestRun> {
  try {
    const response = await requestControlPlane({
      operation: "startSandboxProfileMaintenanceScriptTestRun",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/maintenance-script/test-runs`,
      body: {
        maintenanceScript: input.maintenanceScript,
        ...(input.runtimeConfig === undefined
          ? {}
          : {
              agentRuntimeId: input.runtimeConfig.agentRuntimeId,
              ...(input.runtimeConfig.sandboxProvider === null
                ? {}
                : { sandboxProvider: input.runtimeConfig.sandboxProvider }),
              sandboxConnectionId: input.runtimeConfig.sandboxConnectionId,
              sandboxResources: input.runtimeConfig.sandboxResources,
            }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start maintenance script test run.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SandboxProfileMaintenanceScriptTestRunResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "startSandboxProfileMaintenanceScriptTestRun",
        status: 500,
        body: responseBody,
        message: "Maintenance script test run response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "startSandboxProfileMaintenanceScriptTestRun",
        error,
        fallbackMessage: "Could not start maintenance script test run.",
      }),
    );
  }
}

export async function startSandboxProfileSetupAssistant(input: {
  profileId: string;
  version: number;
  idempotencyKey?: string;
  scriptKind?: "maintenance" | "setup";
  signal?: AbortSignal;
}): Promise<SandboxProfileSetupAssistant> {
  try {
    const response = await requestControlPlane({
      operation: "startSandboxProfileSetupAssistant",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/setup-script/assistant`,
      body: {
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        ...(input.scriptKind === undefined ? {} : { scriptKind: input.scriptKind }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start Setup Assistant.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileSetupAssistantResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "startSandboxProfileSetupAssistant",
        status: 500,
        body: responseBody,
        message: "Setup Assistant response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "startSandboxProfileSetupAssistant",
        error,
        fallbackMessage: "Could not start Setup Assistant.",
      }),
    );
  }
}
