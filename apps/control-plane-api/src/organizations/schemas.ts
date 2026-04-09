import { z } from "@hono/zod-openapi";

import { ORGANIZATION_ROLES } from "../auth/services/organization-policy.js";
import { singletonImageMetadataResponseSchema } from "../lib/singleton-image-metadata.js";

export const OrganizationRoleSchema = z.enum(ORGANIZATION_ROLES);

export const MembershipCapabilitiesSchema = z
  .object({
    organizationId: z.string().min(1),
    actorRole: OrganizationRoleSchema,
    invite: z
      .object({
        canExecute: z.boolean(),
        assignableRoles: z.array(OrganizationRoleSchema),
      })
      .strict(),
    memberRoleUpdate: z
      .object({
        canExecute: z.boolean(),
        roleTransitionMatrix: z.record(OrganizationRoleSchema, z.array(OrganizationRoleSchema)),
      })
      .strict(),
  })
  .strict();

export const organizationLogoResponseSchema = singletonImageMetadataResponseSchema;

export const MemberAvatarSchema = z
  .object({
    userId: z.string().min(1),
    hasImage: z.boolean(),
    imageUrl: z.url().nullable(),
  })
  .strict();

export const DirectoryFilterSchema = z.enum(["all", "members", "invitations"]);

export const DirectoryMemberEntrySchema = z
  .object({
    kind: z.literal("member"),
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().min(1),
    email: z.string().min(1),
    role: OrganizationRoleSchema,
    joinedAt: z.iso.datetime(),
    avatar: MemberAvatarSchema.omit({ userId: true }),
  })
  .strict();

export const DirectoryInvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "canceled",
  "rejected",
  "revoked",
  "unknown",
]);

export const DirectoryInvitationEntrySchema = z
  .object({
    kind: z.literal("invitation"),
    id: z.string().min(1),
    organizationId: z.string().min(1),
    email: z.string().min(1),
    role: OrganizationRoleSchema,
    inviterId: z.string().min(1),
    status: DirectoryInvitationStatusSchema,
    rawStatus: z.string().nullable(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const DirectoryEntrySchema = z.discriminatedUnion("kind", [
  DirectoryMemberEntrySchema,
  DirectoryInvitationEntrySchema,
]);

export const DirectoryResponseSchema = z
  .object({
    entries: z.array(DirectoryEntrySchema),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();
