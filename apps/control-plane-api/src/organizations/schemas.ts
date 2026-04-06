import { z } from "@hono/zod-openapi";

import { ORGANIZATION_ROLES } from "../auth/services/organization-policy.js";

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

export const organizationLogoResponseSchema = z
  .object({
    imageUrl: z.url(),
  })
  .strict();

export const organizationLogoStateResponseSchema = z
  .object({
    imageUrl: z.url().nullable(),
  })
  .strict();
