import type { SettingsMember } from "./members-api-types.js";
import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";
import {
  compactMap,
  parseMembersRecord,
  readMembersNumber,
  readMembersString,
} from "./members-records.js";

export type ParsedMembersPage = {
  members: SettingsMember[];
  total: number;
  rawCount: number;
};

function parseMember(value: unknown): SettingsMember | null {
  const record = parseMembersRecord(value);
  if (record === null) {
    return null;
  }

  const user = parseMembersRecord(record["user"]);
  const role = parseOrganizationRoleValue(record["role"]);
  const id = readMembersString(record, "id");
  const userId = readMembersString(record, "userId");
  const joinedAt = parseTimestampToIsoString(record["createdAt"]);
  if (role === null || id === null || userId === null || joinedAt === null) {
    return null;
  }

  if (user === null) {
    return null;
  }

  const email = readMembersString(user, "email");
  const name = readMembersString(user, "name");
  if (email === null) {
    return null;
  }

  return {
    id,
    userId,
    name: name ?? email,
    email,
    role,
    joinedAt,
  };
}

export function parseMembersPageResponse(value: unknown): ParsedMembersPage {
  const record = parseMembersRecord(value);
  if (record === null) {
    throw new Error("Members response was invalid.");
  }

  const membersValue = record["members"];
  if (!Array.isArray(membersValue)) {
    throw new Error("Members response did not include a members array.");
  }

  const total = readMembersNumber(record, "total");
  if (total === null) {
    throw new Error("Members response did not include a numeric total.");
  }

  return {
    members: compactMap(membersValue, parseMember),
    total,
    rawCount: membersValue.length,
  };
}
