import {
  isOrganizationPermission,
  OrganizationPermissions,
  type OrganizationPermission,
} from "../../auth/services/organization-policy.js";

const ApiKeyUnsupportedPermissions = new Set<OrganizationPermission>([
  OrganizationPermissions.DESIGNER_SESSION_CREATE,
  OrganizationPermissions.DESIGNER_SESSION_READ,
  OrganizationPermissions.DESIGNER_SESSION_UPDATE,
]);

export function isApiKeyAssignablePermission(permission: OrganizationPermission): boolean {
  return !ApiKeyUnsupportedPermissions.has(permission);
}

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
