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

export const MemberAvatarsResponseSchema = z.array(MemberAvatarSchema);
