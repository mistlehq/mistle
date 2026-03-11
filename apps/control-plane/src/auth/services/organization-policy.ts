export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

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
  if (actorRole === "owner") {
    return ["owner", "admin", "member"];
  }

  if (actorRole === "admin") {
    return ["admin", "member"];
  }

  return [];
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
      canExecute: input.actorRole === "owner" || input.actorRole === "admin",
      roleTransitionMatrix: getRoleTransitionMatrix(input.actorRole),
    },
  };
}
