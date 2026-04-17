import { getControlPlaneApiClient } from "../../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { MembersApiError } from "../members/members-api-errors.js";
import type {
  OrganizationSandboxStorageSettingsResponse,
  UpdateOrganizationSandboxStorageSettingsRequest,
} from "./sandbox-storage-model.js";

export function organizationSandboxStorageSettingsQueryKey(
  activeOrganizationId: string,
): readonly ["settings", "organization-sandbox-storage", string] {
  return ["settings", "organization-sandbox-storage", activeOrganizationId];
}

export async function getOrganizationSandboxStorageSettings(): Promise<OrganizationSandboxStorageSettingsResponse> {
  try {
    const client = getControlPlaneApiClient();
    const response = await client.GET("/v1/organization/sandbox-storage-settings", {
      credentials: "include",
    });
    if (response.error !== undefined) {
      throw response.error;
    }

    const data = response.data;

    if (data === undefined) {
      throw new MembersApiError({
        operation: "getOrganizationSandboxStorageSettings",
        status: 500,
        body: null,
        message: "Sandbox storage settings response was empty.",
        code: null,
      });
    }

    return normalizeOrganizationSandboxStorageSettingsResponse(data);
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "getOrganizationSandboxStorageSettings",
        error,
        fallbackMessage: "Could not load sandbox storage settings.",
      }),
    );
  }
}

export async function updateOrganizationSandboxStorageSettings(input: {
  payload: UpdateOrganizationSandboxStorageSettingsRequest;
}): Promise<OrganizationSandboxStorageSettingsResponse> {
  try {
    const client = getControlPlaneApiClient();
    const response = await client.PUT("/v1/organization/sandbox-storage-settings", {
      credentials: "include",
      body: input.payload,
    });
    if (response.error !== undefined) {
      throw response.error;
    }

    const data = response.data;

    if (data === undefined) {
      throw new MembersApiError({
        operation: "updateOrganizationSandboxStorageSettings",
        status: 500,
        body: null,
        message: "Updated sandbox storage settings response was empty.",
        code: null,
      });
    }

    return normalizeOrganizationSandboxStorageSettingsResponse(data);
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "updateOrganizationSandboxStorageSettings",
        error,
        fallbackMessage: "Could not update sandbox storage settings.",
      }),
    );
  }
}

function normalizeOrganizationSandboxStorageSettingsResponse(input: {
  organizationStorageConfigSummary: {
    apiKeyConfigured: boolean;
    backend: "archil";
    mounts:
      | []
      | {
          accessKeyId: string;
          bucket: string;
          endpoint: string;
          secretAccessKeyConfigured: boolean;
          type: "s3-compatible";
        }[];
    namePrefix: string | null;
    region: string;
  } | null;
  persistentSandboxesEnabled: boolean;
  storageBackend: "archil" | null;
  storageConfigSource: "managed" | "organization";
  storageConfigVersion: number | null;
}): OrganizationSandboxStorageSettingsResponse {
  const organizationStorageConfigSummary = input.organizationStorageConfigSummary;

  if (organizationStorageConfigSummary === null) {
    return {
      ...input,
      organizationStorageConfigSummary: null,
    };
  }

  if (organizationStorageConfigSummary.mounts.length > 1) {
    throw new Error("Organization sandbox storage summary included more than one mount.");
  }

  const mount = organizationStorageConfigSummary.mounts[0];

  return {
    ...input,
    organizationStorageConfigSummary: {
      ...organizationStorageConfigSummary,
      mounts:
        mount === undefined
          ? []
          : [
              {
                accessKeyId: mount.accessKeyId,
                bucket: mount.bucket,
                endpoint: mount.endpoint,
                secretAccessKeyConfigured: mount.secretAccessKeyConfigured,
                type: mount.type,
              },
            ],
    },
  };
}
