export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const OrganizationPermissions = {
  ORGANIZATION_READ: "organization:read",
  ORGANIZATION_UPDATE: "organization:update",
  ORGANIZATION_LOGO_READ: "organizationLogo:read",
  ORGANIZATION_LOGO_UPDATE: "organizationLogo:update",
  ORGANIZATION_MEMBERSHIP_READ: "organizationMembership:read",
  ORGANIZATION_MEMBERSHIP_CREATE: "organizationMembership:create",
  ORGANIZATION_MEMBERSHIP_UPDATE: "organizationMembership:update",
  ORGANIZATION_MEMBERSHIP_DELETE: "organizationMembership:delete",
  SANDBOX_PROFILE_READ: "sandboxProfile:read",
  SANDBOX_PROFILE_CREATE: "sandboxProfile:create",
  SANDBOX_PROFILE_UPDATE: "sandboxProfile:update",
  SANDBOX_PROFILE_DELETE: "sandboxProfile:delete",
  SANDBOX_SESSION_CREATE: "sandboxSession:create",
  SANDBOX_SESSION_READ: "sandboxSession:read",
  SANDBOX_SESSION_RESUME: "sandboxSession:resume",
  SANDBOX_SESSION_CONNECT: "sandboxSession:connect",
  INTEGRATION_CONNECTION_READ: "integrationConnection:read",
  INTEGRATION_CONNECTION_CREATE: "integrationConnection:create",
  INTEGRATION_CONNECTION_UPDATE: "integrationConnection:update",
  INTEGRATION_CONNECTION_DELETE: "integrationConnection:delete",
  INTEGRATION_WEBHOOK_SOURCE_READ: "integrationWebhookSource:read",
  INTEGRATION_WEBHOOK_SOURCE_CREATE: "integrationWebhookSource:create",
  INTEGRATION_WEBHOOK_SOURCE_UPDATE: "integrationWebhookSource:update",
  INTEGRATION_WEBHOOK_SOURCE_DELETE: "integrationWebhookSource:delete",
  CREDENTIAL_KEY_READ: "credentialKey:read",
  CREDENTIAL_KEY_MANAGE: "credentialKey:manage",
  AUTOMATION_WEBHOOK_READ: "automationWebhook:read",
  AUTOMATION_WEBHOOK_CREATE: "automationWebhook:create",
  AUTOMATION_WEBHOOK_UPDATE: "automationWebhook:update",
  AUTOMATION_WEBHOOK_DELETE: "automationWebhook:delete",
  API_KEY_READ: "apiKey:read",
  API_KEY_MANAGE: "apiKey:manage",
} as const;

export type OrganizationPermission =
  (typeof OrganizationPermissions)[keyof typeof OrganizationPermissions];

const OWNER_PERMISSIONS: readonly OrganizationPermission[] = [
  OrganizationPermissions.ORGANIZATION_READ,
  OrganizationPermissions.ORGANIZATION_UPDATE,
  OrganizationPermissions.ORGANIZATION_LOGO_READ,
  OrganizationPermissions.ORGANIZATION_LOGO_UPDATE,
  OrganizationPermissions.ORGANIZATION_MEMBERSHIP_READ,
  OrganizationPermissions.ORGANIZATION_MEMBERSHIP_CREATE,
  OrganizationPermissions.ORGANIZATION_MEMBERSHIP_UPDATE,
  OrganizationPermissions.ORGANIZATION_MEMBERSHIP_DELETE,
  OrganizationPermissions.SANDBOX_PROFILE_READ,
  OrganizationPermissions.SANDBOX_PROFILE_CREATE,
  OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  OrganizationPermissions.SANDBOX_PROFILE_DELETE,
  OrganizationPermissions.SANDBOX_SESSION_CREATE,
  OrganizationPermissions.SANDBOX_SESSION_READ,
  OrganizationPermissions.SANDBOX_SESSION_RESUME,
  OrganizationPermissions.SANDBOX_SESSION_CONNECT,
  OrganizationPermissions.INTEGRATION_CONNECTION_READ,
  OrganizationPermissions.INTEGRATION_CONNECTION_CREATE,
  OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
  OrganizationPermissions.INTEGRATION_CONNECTION_DELETE,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_READ,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_CREATE,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_UPDATE,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_DELETE,
  OrganizationPermissions.CREDENTIAL_KEY_READ,
  OrganizationPermissions.CREDENTIAL_KEY_MANAGE,
  OrganizationPermissions.AUTOMATION_WEBHOOK_READ,
  OrganizationPermissions.AUTOMATION_WEBHOOK_CREATE,
  OrganizationPermissions.AUTOMATION_WEBHOOK_UPDATE,
  OrganizationPermissions.AUTOMATION_WEBHOOK_DELETE,
  OrganizationPermissions.API_KEY_READ,
  OrganizationPermissions.API_KEY_MANAGE,
];

const ADMIN_PERMISSIONS: readonly OrganizationPermission[] = OWNER_PERMISSIONS;

const MEMBER_PERMISSIONS: readonly OrganizationPermission[] = [
  OrganizationPermissions.ORGANIZATION_READ,
  OrganizationPermissions.ORGANIZATION_LOGO_READ,
  OrganizationPermissions.ORGANIZATION_MEMBERSHIP_READ,
  OrganizationPermissions.SANDBOX_PROFILE_READ,
  OrganizationPermissions.SANDBOX_PROFILE_CREATE,
  OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  OrganizationPermissions.SANDBOX_PROFILE_DELETE,
  OrganizationPermissions.SANDBOX_SESSION_CREATE,
  OrganizationPermissions.SANDBOX_SESSION_READ,
  OrganizationPermissions.SANDBOX_SESSION_RESUME,
  OrganizationPermissions.SANDBOX_SESSION_CONNECT,
  OrganizationPermissions.INTEGRATION_CONNECTION_READ,
  OrganizationPermissions.INTEGRATION_CONNECTION_CREATE,
  OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
  OrganizationPermissions.INTEGRATION_CONNECTION_DELETE,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_READ,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_CREATE,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_UPDATE,
  OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_DELETE,
  OrganizationPermissions.CREDENTIAL_KEY_READ,
  OrganizationPermissions.AUTOMATION_WEBHOOK_READ,
  OrganizationPermissions.AUTOMATION_WEBHOOK_CREATE,
  OrganizationPermissions.AUTOMATION_WEBHOOK_UPDATE,
  OrganizationPermissions.AUTOMATION_WEBHOOK_DELETE,
];

const ORGANIZATION_PERMISSION_VALUES = new Set<string>(Object.values(OrganizationPermissions));

export function isOrganizationPermission(value: string): value is OrganizationPermission {
  return ORGANIZATION_PERMISSION_VALUES.has(value);
}

function normalizeRole(value: string): OrganizationRole | null {
  if (value === "owner" || value === "admin" || value === "member") {
    return value;
  }

  return null;
}

export function parseOrganizationRole(value: string): OrganizationRole | null {
  const directRole = normalizeRole(value);
  if (directRole !== null) {
    return directRole;
  }

  const roleEntries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (roleEntries.length === 0) {
    return null;
  }

  // Prefer highest privilege in legacy multi-role payloads.
  if (roleEntries.includes("owner")) {
    return "owner";
  }
  if (roleEntries.includes("admin")) {
    return "admin";
  }
  if (roleEntries.includes("member")) {
    return "member";
  }

  return null;
}

export function getInviteAssignableRoles(actorRole: OrganizationRole): OrganizationRole[] {
  if (
    !hasOrganizationPermission(actorRole, OrganizationPermissions.ORGANIZATION_MEMBERSHIP_CREATE)
  ) {
    return [];
  }

  if (actorRole === "owner") {
    return ["owner", "admin", "member"];
  }

  return ["admin", "member"];
}

export function getOrganizationPermissions(
  actorRole: OrganizationRole,
): readonly OrganizationPermission[] {
  if (actorRole === "owner") {
    return OWNER_PERMISSIONS;
  }

  if (actorRole === "admin") {
    return ADMIN_PERMISSIONS;
  }

  return MEMBER_PERMISSIONS;
}

export function hasOrganizationPermission(
  actorRole: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return getOrganizationPermissions(actorRole).includes(permission);
}

export function canManageOrganization(actorRole: OrganizationRole): boolean {
  return hasOrganizationPermission(actorRole, OrganizationPermissions.ORGANIZATION_UPDATE);
}

export function getRoleTransitionMatrix(
  actorRole: OrganizationRole,
): Record<OrganizationRole, OrganizationRole[]> {
  if (actorRole === "owner") {
    return {
      owner: ["owner", "admin", "member"],
      admin: ["owner", "admin", "member"],
      member: ["owner", "admin", "member"],
    };
  }

  if (actorRole === "admin") {
    return {
      owner: [],
      admin: ["admin", "member"],
      member: ["admin", "member"],
    };
  }

  return {
    owner: [],
    admin: [],
    member: [],
  };
}

export function buildMembershipCapabilities(input: {
  actorRole: OrganizationRole;
  organizationId: string;
}): {
  organizationId: string;
  actorRole: OrganizationRole;
  invite: {
    canExecute: boolean;
    assignableRoles: OrganizationRole[];
  };
  memberRoleUpdate: {
    canExecute: boolean;
    roleTransitionMatrix: Record<OrganizationRole, OrganizationRole[]>;
  };
} {
  const assignableRoles = getInviteAssignableRoles(input.actorRole);

  return {
    organizationId: input.organizationId,
    actorRole: input.actorRole,
    invite: {
      canExecute: assignableRoles.length > 0,
      assignableRoles,
    },
    memberRoleUpdate: {
      canExecute: hasOrganizationPermission(
        input.actorRole,
        OrganizationPermissions.ORGANIZATION_MEMBERSHIP_UPDATE,
      ),
      roleTransitionMatrix: getRoleTransitionMatrix(input.actorRole),
    },
  };
}
