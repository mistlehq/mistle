import type { S3CompatibleObjectStore } from "@mistle/object-store";

export type OrganizationRole = "owner" | "admin" | "member";
export type InvitationStatus = "pending" | "accepted" | "canceled" | "rejected" | "revoked";

export function resolveDirectoryMemberName(input: { name: string; email: string }): string {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0 || trimmedName === input.email) {
    return input.email;
  }

  return trimmedName;
}

export function normalizeInvitationStatus(status: string): InvitationStatus {
  if (
    status === "pending" ||
    status === "accepted" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "revoked"
  ) {
    return status;
  }

  throw new Error(`Unexpected invitation status: ${status}`);
}

export function normalizeOrganizationRole(role: string | null): OrganizationRole {
  if (role === "owner" || role === "admin" || role === "member") {
    return role;
  }

  throw new Error(`Unexpected organization role: ${String(role)}`);
}

export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export async function createMemberAvatar(input: {
  imageObjectKey: string | null;
  objectStore: S3CompatibleObjectStore;
  presignedUrlTtlSeconds: number;
}): Promise<{
  hasImage: boolean;
  imageUrl: string | null;
}> {
  const imageObjectKey = input.imageObjectKey;
  if (imageObjectKey === null || imageObjectKey.length === 0) {
    return {
      hasImage: false,
      imageUrl: null,
    };
  }

  return {
    hasImage: true,
    imageUrl: await input.objectStore.createPresignedGetUrl({
      objectKey: imageObjectKey,
      expiresInSeconds: input.presignedUrlTtlSeconds,
    }),
  };
}
