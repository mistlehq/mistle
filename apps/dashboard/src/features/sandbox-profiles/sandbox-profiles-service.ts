import { getControlPlaneApiClient } from "../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../api/http-api-error.js";
import { SandboxProfilesApiError } from "./sandbox-profiles-api-errors.js";
import type {
  CreateSandboxProfileInput,
  SandboxProfile,
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
