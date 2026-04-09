import type {
  MemberAvatar,
  MembersDirectoryPage,
  SettingsInvitation,
  SettingsMember,
} from "./members-api-types.js";
import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";
import { readBoolean, readNumber, readString, toRecord } from "./members-records.js";

export function parseMembersDirectoryPage(value: unknown): MembersDirectoryPage {
  const record = toRecord(value);
  if (record === null) {
    throw new Error("Members directory response was invalid.");
  }

  const entriesValue = record["entries"];
  if (!Array.isArray(entriesValue)) {
    throw new Error("Members directory response did not include an entries array.");
  }

  const limit = readNumber(record, "limit");
  const offset = readNumber(record, "offset");
  const total = readNumber(record, "total");
  if (limit === null || offset === null || total === null) {
    throw new Error("Members directory response did not include numeric pagination metadata.");
  }

  const members: SettingsMember[] = [];
  const invitations: SettingsInvitation[] = [];
  const memberAvatarsByUserId = new Map<string, MemberAvatar>();

  for (const entry of entriesValue) {
    const parsedEntry = parseDirectoryEntry(entry);
    if (parsedEntry === null) {
      throw new Error("Members directory response included an invalid entry.");
    }

    if (parsedEntry.kind === "member") {
      members.push(parsedEntry.member);
      memberAvatarsByUserId.set(parsedEntry.avatar.userId, parsedEntry.avatar);
      continue;
    }

    invitations.push(parsedEntry.invitation);
  }

  return {
    members,
    invitations,
    memberAvatarsByUserId,
    limit,
    offset,
    total,
  };
}

function parseDirectoryEntry(value: unknown):
  | {
      kind: "member";
      member: SettingsMember;
      avatar: MemberAvatar;
    }
  | {
      kind: "invitation";
      invitation: SettingsInvitation;
    }
  | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const kind = readString(record, "kind");
  if (kind === "member") {
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
      kind: "member",
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

  if (kind === "invitation") {
    const id = readString(record, "id");
    const organizationId = readString(record, "organizationId");
    const email = readString(record, "email");
    const role = parseOrganizationRoleValue(record["role"]);
    const inviterId = readString(record, "inviterId");
    const status = readString(record, "status");
    const expiresAt = parseTimestampToIsoString(record["expiresAt"]);
    const createdAt = parseTimestampToIsoString(record["createdAt"]);
    const rawStatus = parseNullableString(record["rawStatus"]);
    if (
      id === null ||
      organizationId === null ||
      email === null ||
      role === null ||
      inviterId === null ||
      status === null ||
      expiresAt === null ||
      createdAt === null ||
      rawStatus === undefined
    ) {
      return null;
    }

    if (
      status !== "pending" &&
      status !== "accepted" &&
      status !== "canceled" &&
      status !== "rejected" &&
      status !== "revoked" &&
      status !== "unknown"
    ) {
      return null;
    }

    return {
      kind: "invitation",
      invitation: {
        id,
        organizationId,
        email,
        role,
        inviterId,
        status,
        rawStatus,
        expiresAt,
        createdAt,
      },
    };
  }

  return null;
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
