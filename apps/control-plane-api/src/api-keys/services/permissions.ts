import {
  isOrganizationPermission,
  type OrganizationPermission,
} from "../../auth/services/organization-policy.js";

export function parseApiKeyPermissions(permissions: readonly string[]): OrganizationPermission[] {
  const parsedPermissions: OrganizationPermission[] = [];

  for (const permission of permissions) {
    if (!isOrganizationPermission(permission)) {
      throw new Error(`Permission '${permission}' is not recognized.`);
    }

    parsedPermissions.push(permission);
  }

  return parsedPermissions;
}
