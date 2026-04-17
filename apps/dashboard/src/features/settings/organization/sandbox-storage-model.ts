import type { OrganizationRole } from "../members/members-api-types.js";

export type OrganizationSandboxStorageSettingsResponse = {
  organizationStorageConfigSummary: {
    apiKeyConfigured: boolean;
    backend: "archil";
    mounts:
      | []
      | [
          {
            accessKeyId: string;
            bucket: string;
            endpoint: string;
            secretAccessKeyConfigured: boolean;
            type: "s3-compatible";
          },
        ];
    namePrefix: string | null;
    region: string;
  } | null;
  persistentSandboxesEnabled: boolean;
  storageBackend: "archil" | null;
  storageConfigSource: "managed" | "organization";
  storageConfigVersion: number | null;
};
export type UpdateOrganizationSandboxStorageSettingsRequest =
  | {
      persistentSandboxesEnabled: boolean;
      storageConfigSource: "managed";
      organizationStorageConfig: null;
    }
  | {
      persistentSandboxesEnabled: boolean;
      storageConfigSource: "organization";
      organizationStorageConfig: {
        backend: "archil";
        apiKey: string;
        region: string;
        namePrefix?: string;
        mounts: [
          {
            type: "s3-compatible";
            bucket: string;
            endpoint: string;
            accessKeyId: string;
            secretAccessKey: string;
          },
        ];
      };
    };

export type OrganizationSandboxStorageFormState = {
  persistentSandboxesEnabled: boolean;
  storageConfigSource: "managed" | "organization";
  region: string;
  namePrefix: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  secretAccessKeyConfigured: boolean;
};

export type OrganizationSandboxStorageFormErrors = Partial<
  Record<"region" | "apiKey" | "bucket" | "endpoint" | "accessKeyId" | "secretAccessKey", string>
>;

export function canManageOrganizationSandboxStorage(input: {
  actorRole: OrganizationRole;
}): boolean {
  return input.actorRole === "owner" || input.actorRole === "admin";
}

export function createOrganizationSandboxStorageFormState(
  input: OrganizationSandboxStorageSettingsResponse,
): OrganizationSandboxStorageFormState {
  if (input.storageConfigSource === "managed") {
    return {
      persistentSandboxesEnabled: input.persistentSandboxesEnabled,
      storageConfigSource: "managed",
      region: "",
      namePrefix: "",
      apiKey: "",
      apiKeyConfigured: false,
      bucket: "",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
      secretAccessKeyConfigured: false,
    };
  }

  const organizationStorageConfigSummary = input.organizationStorageConfigSummary;
  if (organizationStorageConfigSummary === null) {
    throw new Error("Organization sandbox storage summary is required for organization overrides.");
  }

  const mount = organizationStorageConfigSummary.mounts[0];

  return {
    persistentSandboxesEnabled: input.persistentSandboxesEnabled,
    storageConfigSource: "organization",
    region: organizationStorageConfigSummary.region,
    namePrefix: organizationStorageConfigSummary.namePrefix ?? "",
    apiKey: "",
    apiKeyConfigured: organizationStorageConfigSummary.apiKeyConfigured,
    bucket: mount?.bucket ?? "",
    endpoint: mount?.endpoint ?? "",
    accessKeyId: mount?.accessKeyId ?? "",
    secretAccessKey: "",
    secretAccessKeyConfigured: mount?.secretAccessKeyConfigured ?? false,
  };
}

export function validateOrganizationSandboxStorageFormState(
  input: OrganizationSandboxStorageFormState,
): OrganizationSandboxStorageFormErrors {
  if (input.storageConfigSource === "managed") {
    return {};
  }

  const errors: OrganizationSandboxStorageFormErrors = {};
  if (input.region.trim().length === 0) {
    errors.region = "Region is required.";
  }
  if (input.apiKey.trim().length === 0) {
    errors.apiKey = "API key is required.";
  }
  if (input.bucket.trim().length === 0) {
    errors.bucket = "Bucket is required.";
  }
  if (input.endpoint.trim().length === 0) {
    errors.endpoint = "Endpoint is required.";
  }
  if (input.accessKeyId.trim().length === 0) {
    errors.accessKeyId = "Access key ID is required.";
  }
  if (input.secretAccessKey.trim().length === 0) {
    errors.secretAccessKey = "Secret access key is required.";
  }

  return errors;
}

export function createOrganizationSandboxStorageUpdatePayload(
  input: OrganizationSandboxStorageFormState,
): UpdateOrganizationSandboxStorageSettingsRequest {
  if (input.storageConfigSource === "managed") {
    return {
      persistentSandboxesEnabled: input.persistentSandboxesEnabled,
      storageConfigSource: "managed",
      organizationStorageConfig: null,
    };
  }

  return {
    persistentSandboxesEnabled: input.persistentSandboxesEnabled,
    storageConfigSource: "organization",
    organizationStorageConfig: {
      backend: "archil",
      apiKey: input.apiKey.trim(),
      region: input.region.trim(),
      ...(input.namePrefix.trim().length === 0 ? {} : { namePrefix: input.namePrefix.trim() }),
      mounts: [
        {
          type: "s3-compatible",
          bucket: input.bucket.trim(),
          endpoint: input.endpoint.trim(),
          accessKeyId: input.accessKeyId.trim(),
          secretAccessKey: input.secretAccessKey.trim(),
        },
      ],
    },
  };
}

export function sandboxStorageFormStatesEqual(input: {
  left: OrganizationSandboxStorageFormState;
  right: OrganizationSandboxStorageFormState;
}): boolean {
  return (
    JSON.stringify(normalizeOrganizationSandboxStorageFormState(input.left)) ===
    JSON.stringify(normalizeOrganizationSandboxStorageFormState(input.right))
  );
}

function normalizeOrganizationSandboxStorageFormState(
  input: OrganizationSandboxStorageFormState,
): OrganizationSandboxStorageFormState {
  if (input.storageConfigSource === "managed") {
    return {
      ...input,
      region: "",
      namePrefix: "",
      apiKey: "",
      apiKeyConfigured: false,
      bucket: "",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
      secretAccessKeyConfigured: false,
    };
  }

  return {
    ...input,
    region: input.region.trim(),
    namePrefix: input.namePrefix.trim(),
    apiKey: input.apiKey.trim(),
    bucket: input.bucket.trim(),
    endpoint: input.endpoint.trim(),
    accessKeyId: input.accessKeyId.trim(),
    secretAccessKey: input.secretAccessKey.trim(),
  };
}
