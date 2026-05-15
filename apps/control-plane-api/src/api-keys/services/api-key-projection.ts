import type { ApiKey } from "@mistle/db/control-plane";
import { z } from "zod";

import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import type { ApiKeySchema } from "../schemas.js";

export type ApiKeyResponse = z.output<typeof ApiKeySchema>;

export function projectApiKey(input: {
  apiKey: ApiKey;
  permissions: readonly OrganizationPermission[];
}): ApiKeyResponse {
  return {
    id: input.apiKey.id,
    name: input.apiKey.name,
    secretPrefix: input.apiKey.secretPrefix,
    permissions: [...input.permissions],
    expiresAt: formatOptionalTimestamp(input.apiKey.expiresAt),
    lastUsedAt: formatOptionalTimestamp(input.apiKey.lastUsedAt),
    createdAt: formatTimestamp(input.apiKey.createdAt),
    updatedAt: formatTimestamp(input.apiKey.updatedAt),
  };
}

function formatOptionalTimestamp(value: string | null): string | null {
  return value === null ? null : formatTimestamp(value);
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString();
}
