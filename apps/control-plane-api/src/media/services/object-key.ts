import { typeid } from "typeid-js";

export function createUserAvatarObjectKey(userId: string): string {
  return `avatars/users/${userId}/${typeid("img").toString()}-avatar.webp`;
}

export function createOrganizationLogoObjectKey(organizationId: string): string {
  return `avatars/organizations/${organizationId}/${typeid("img").toString()}-logo.webp`;
}
