import { z } from "zod";

import { getControlPlaneApiClient } from "../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "./sandbox-profiles-api-errors.js";
import type {
  CreateSandboxProfileInput,
  DeleteSandboxProfileResult,
  LaunchableSandboxProfilesResult,
  SandboxIntegrationBindingKind,
  SandboxProfile,
  SandboxProfileVersion,
  SandboxProfileVersionPublishability,
  SandboxProfileVersionIntegrationBinding,
  SandboxProfileVersionAutomationConfig,
  SandboxProfileVersionSetupScript,
  SandboxProfilesListResult,
  PublishSandboxProfileVersionResult,
  UpdateSandboxProfileInput,
} from "./sandbox-profiles-types.js";

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

const SandboxProfileVersionSchema = z
  .object({
    isActive: z.boolean(),
    sandboxProfileId: z.string().min(1),
    state: z.enum(["draft", "published"]),
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
    activeVersion: z.number().int().min(1),
    version: SandboxProfileVersionSchema,
  })
  .strict();

const DiscardSandboxProfileVersionDraftResultSchema = z
  .object({
    discardedVersion: z.number().int().min(1),
    hasDraft: z.boolean(),
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

const IntegrationBindingKindSchema = z.enum(["agent", "git", "connector"]);

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

const SandboxProfileRepositoryOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

const SandboxProfileVersionAutomationConfigResponseSchema = z
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

export async function getSandboxProfileVersionAutomationConfig(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<SandboxProfileVersionAutomationConfig> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxProfileVersionAutomationConfig",
      method: "GET",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/automation-config`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load sandbox profile automation config.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SandboxProfileVersionAutomationConfigResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxProfileVersionAutomationConfig",
        status: 500,
        body: responseBody,
        message: "Sandbox profile automation config response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxProfileVersionAutomationConfig",
        error,
        fallbackMessage: "Could not load sandbox profile automation config.",
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

export async function putSandboxProfileVersionIntegrationBindings(input: {
  profileId: string;
  version: number;
  bindings: Array<{
    id?: string;
    clientRef?: string;
    connectionId: string;
    kind: SandboxIntegrationBindingKind;
    config: Record<string, unknown>;
  }>;
}): Promise<{ bindings: SandboxProfileVersionIntegrationBinding[] }> {
  try {
    const response = await requestControlPlane({
      operation: "putSandboxProfileVersionIntegrationBindings",
      method: "PUT",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/integration-bindings`,
      body: {
        bindings: input.bindings,
      },
      fallbackMessage: "Could not save sandbox profile integration bindings.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SandboxProfileVersionIntegrationBindingsResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "putSandboxProfileVersionIntegrationBindings",
        status: 500,
        body: responseBody,
        message: "Sandbox profile integration bindings response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "putSandboxProfileVersionIntegrationBindings",
        error,
        fallbackMessage: "Could not save sandbox profile integration bindings.",
      }),
    );
  }
}

export async function putSandboxProfileVersionSetupScript(input: {
  profileId: string;
  version: number;
  setupScript: string | null;
}): Promise<SandboxProfileVersionSetupScript> {
  try {
    const response = await requestControlPlane({
      operation: "putSandboxProfileVersionSetupScript",
      method: "PUT",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(
        input.version,
      )}/setup-script`,
      body: {
        setupScript: input.setupScript,
      },
      fallbackMessage: "Could not save sandbox profile setup script.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxProfileVersionSetupScriptResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "putSandboxProfileVersionSetupScript",
        status: 500,
        body: responseBody,
        message: "Sandbox profile setup script response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "putSandboxProfileVersionSetupScript",
        error,
        fallbackMessage: "Could not save sandbox profile setup script.",
      }),
    );
  }
}
