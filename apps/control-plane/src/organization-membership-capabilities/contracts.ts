import { createRoute, z } from "@hono/zod-openapi";

import { ORGANIZATION_ROLES } from "../auth/services/organization-policy.js";

const OrganizationRoleSchema = z.enum(ORGANIZATION_ROLES);

const MembershipCapabilitiesDataSchema = z
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

export const MembershipCapabilitiesSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    data: MembershipCapabilitiesDataSchema,
    error: z.null(),
  })
  .strict();

const MembershipCapabilitiesErrorCodeSchema = z.enum(["FORBIDDEN", "NOT_FOUND"]);

export const MembershipCapabilitiesErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    data: z.null(),
    error: z
      .object({
        code: MembershipCapabilitiesErrorCodeSchema,
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const MembershipCapabilitiesParamsSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const MembershipCapabilitiesUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const MembershipCapabilitiesActiveOrganizationRequiredResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();

export const getOrganizationMembershipCapabilitiesRoute = createRoute({
  method: "get",
  path: "/{organizationId}/membership-capabilities",
  tags: ["Organizations"],
  request: {
    params: MembershipCapabilitiesParamsSchema,
  },
  responses: {
    200: {
      description: "Membership capabilities for the current actor in the organization.",
      content: {
        "application/json": {
          schema: MembershipCapabilitiesSuccessResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: MembershipCapabilitiesUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden request.",
      content: {
        "application/json": {
          schema: z.union([
            MembershipCapabilitiesActiveOrganizationRequiredResponseSchema,
            MembershipCapabilitiesErrorResponseSchema,
          ]),
        },
      },
    },
    404: {
      description: "Organization was not found.",
      content: {
        "application/json": {
          schema: MembershipCapabilitiesErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
