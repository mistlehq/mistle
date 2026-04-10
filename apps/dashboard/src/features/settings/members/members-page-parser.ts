import type { MemberAvatar, MembersPage, SettingsMember } from "./members-api-types.js";
import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";
import { readArray, readBoolean, readNumber, readString, toRecord } from "./members-records.js";

export function parseMembersPage(value: unknown): MembersPage {
  const record = toRecord(value);
  if (record === null) {
    throw new Error("Members page response was invalid.");
  }

  const entriesValue = readArray(record["members"]);
  const limit = readNumber(record, "limit");
  const offset = readNumber(record, "offset");
  const total = readNumber(record, "total");
  if (entriesValue === null || limit === null || offset === null || total === null) {
    throw new Error("Members page response did not include valid pagination metadata.");
  }

  const members: SettingsMember[] = [];
  const memberAvatarsByUserId = new Map<string, MemberAvatar>();
  for (const entry of entriesValue) {
    const parsedEntry = parseMemberEntry(entry);
    if (parsedEntry === null) {
      throw new Error("Members page response included an invalid member entry.");
    }

    members.push(parsedEntry.member);
    memberAvatarsByUserId.set(parsedEntry.avatar.userId, parsedEntry.avatar);
  }

  return {
    members,
    memberAvatarsByUserId,
    limit,
    offset,
    total,
  };
}

function parseMemberEntry(value: unknown): {
  member: SettingsMember;
  avatar: MemberAvatar;
} | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const id = readString(record, "id");
  const userId = readString(record, "userId");
  const name = readString(record, "name");
  const email = readString(record, "email");
  const role = parseOrganizationRoleValue(record["role"]);
  const joinedAt = parseTimestampToIsoString(record["joinedAt"]);
  const avatarRecord = toRecord(record["avatar"]);
  if (
    id === null ||
    userId === null ||
    name === null ||
    email === null ||
    role === null ||
    joinedAt === null ||
    avatarRecord === null
  ) {
    return null;
  }

  const hasImage = readBoolean(avatarRecord, "hasImage");
  const imageUrl = parseNullableString(avatarRecord["imageUrl"]);
  if (hasImage === null || imageUrl === undefined) {
    return null;
  }

  return {
    member: {
      id,
      userId,
      name,
      email,
      role,
      joinedAt,
    },
    avatar: {
      userId,
      hasImage,
      imageUrl,
    },
  };
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}
