import type { MembershipCapabilities, OrganizationRole } from "./members-api-types.js";
import { parseOrganizationRoleValue } from "./members-parsing.js";
import {
  parseMembersRecord,
  readMembersArray,
  readMembersBoolean,
  readMembersString,
} from "./members-records.js";

function parseRoleArrayStrict(value: unknown): OrganizationRole[] | null {
  const entries = readMembersArray(value);
  if (entries === null) {
    return null;
  }
  const roles: OrganizationRole[] = [];

  for (const entry of entries) {
    const role = parseOrganizationRoleValue(entry);
    if (role === null) {
      return null;
    }
    roles.push(role);
  }

  return roles;
}

export function parseMembershipCapabilities(value: unknown): MembershipCapabilities | null {
  const record = parseMembersRecord(value);
  if (record === null) {
    return null;
  }

  const organizationId = readMembersString(record, "organizationId");
  const actorRole = parseOrganizationRoleValue(record["actorRole"]);
  const invite = parseMembersRecord(record["invite"]);
  const memberRoleUpdate = parseMembersRecord(record["memberRoleUpdate"]);
  if (
    organizationId === null ||
    actorRole === null ||
    invite === null ||
    memberRoleUpdate === null
  ) {
    return null;
  }

  const inviteCanExecute = readMembersBoolean(invite, "canExecute");
  const assignableRoles = parseRoleArrayStrict(invite["assignableRoles"]);

  const roleTransitionMatrix = parseMembersRecord(memberRoleUpdate["roleTransitionMatrix"]);
  const memberRoleUpdateCanExecute = readMembersBoolean(memberRoleUpdate, "canExecute");
  if (
    inviteCanExecute === null ||
    assignableRoles === null ||
    roleTransitionMatrix === null ||
    memberRoleUpdateCanExecute === null
  ) {
    return null;
  }

  const owner = parseRoleArrayStrict(roleTransitionMatrix["owner"]);
  const admin = parseRoleArrayStrict(roleTransitionMatrix["admin"]);
  const member = parseRoleArrayStrict(roleTransitionMatrix["member"]);
  if (owner === null || admin === null || member === null) {
    return null;
  }

  return {
    organizationId,
    actorRole,
    invite: {
      canExecute: inviteCanExecute,
      assignableRoles,
    },
    memberRoleUpdate: {
      canExecute: memberRoleUpdateCanExecute,
      roleTransitionMatrix: {
        owner,
        admin,
        member,
      },
    },
  };
}
