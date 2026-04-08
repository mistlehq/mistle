import type { MemberAvatar } from "./members-api-types.js";
import { readArray, readBoolean, readString, toRecord } from "./members-records.js";

function parseNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  const record = { value };
  const parsed = readString(record, "value");
  if (parsed === null) {
    return undefined;
  }

  return parsed;
}

function parseMemberAvatar(value: unknown): MemberAvatar | null {
  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const userId = readString(record, "userId");
  const hasImage = readBoolean(record, "hasImage");
  const imageUrl = parseNullableString(record["imageUrl"]);
  if (userId === null || hasImage === null || imageUrl === undefined) {
    return null;
  }

  return {
    userId,
    hasImage,
    imageUrl,
  };
}

export function parseMemberAvatars(value: unknown): MemberAvatar[] | null {
  const entries = readArray(value);
  if (entries === null) {
    return null;
  }

  const avatars: MemberAvatar[] = [];
  for (const entry of entries) {
    const avatar = parseMemberAvatar(entry);
    if (avatar === null) {
      return null;
    }
    avatars.push(avatar);
  }

  return avatars;
}
