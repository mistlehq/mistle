import { z } from "zod";

import { getControlPlaneApiClient } from "../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "./sandbox-profiles-api-errors.js";
import type {
  CreateSandboxProfileInput,
  SandboxIntegrationBindingKind,
  SandboxProfile,
  SandboxProfileVersion,
  SandboxProfileVersionIntegrationBinding,
  SandboxProfilesListResult,
  UpdateSandboxProfileInput,
} from "./sandbox-profiles-types.js";

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
        ...(input.payload.status === undefined ? {} : { status: input.payload.status }),
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

const SandboxProfileVersionSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
  })
  .strict();

const ListSandboxProfileVersionsResponseSchema = z
  .object({
    versions: z.array(SandboxProfileVersionSchema),
  })
  .strict();

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

export async function listSandboxProfileVersions(input: {
  profileId: string;
  signal?: AbortSignal;
}): Promise<{
  versions: SandboxProfileVersion[];
}> {
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

export async function getSandboxProfileVersionIntegrationBindings(input: {
  profileId: string;
  version: number;
  signal?: AbortSignal;
}): Promise<{
  bindings: SandboxProfileVersionIntegrationBinding[];
}> {
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
}): Promise<{
  bindings: SandboxProfileVersionIntegrationBinding[];
}> {
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
