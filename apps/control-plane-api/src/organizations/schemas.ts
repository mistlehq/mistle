import { z } from "@hono/zod-openapi";
import { SandboxStorageBackend, SandboxStorageConfigSources } from "@mistle/db/control-plane";

import { ORGANIZATION_ROLES } from "../auth/services/organization-policy.js";
import { singletonImageMetadataResponseSchema } from "../lib/singleton-image-metadata.js";
import {
  OrganizationSandboxStorageConfigSummarySchema,
  OrganizationSandboxStorageConfigV1Schema,
} from "../sandbox-storage/storage-config.js";

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

export const MembersPageEntrySchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().min(1),
    email: z.string().min(1),
    role: OrganizationRoleSchema,
    joinedAt: z.iso.datetime(),
    avatar: MemberAvatarSchema.omit({ userId: true }),
  })
  .strict();

export const InvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "canceled",
  "rejected",
  "revoked",
]);

export const InvitationsPageEntrySchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    email: z.string().min(1),
    role: OrganizationRoleSchema,
    inviterId: z.string().min(1),
    inviterName: z.string().min(1),
    status: InvitationStatusSchema,
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const MembersPageResponseSchema = z
  .object({
    members: z.array(MembersPageEntrySchema),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();

export const InvitationsPageResponseSchema = z
  .object({
    invitations: z.array(InvitationsPageEntrySchema),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();

export const GetOrganizationSandboxStorageSettingsResponseSchema = z
  .object({
    persistentSandboxesEnabled: z.boolean(),
    storageConfigSource: z.enum([
      SandboxStorageConfigSources.MANAGED,
      SandboxStorageConfigSources.ORGANIZATION,
    ]),
    storageBackend: z.enum([SandboxStorageBackend.ARCHIL]).nullable(),
    storageConfigVersion: z.number().int().nullable(),
    organizationStorageConfigSummary: OrganizationSandboxStorageConfigSummarySchema.nullable(),
  })
  .strict();

export const PutOrganizationSandboxStorageSettingsRequestSchema = z.discriminatedUnion(
  "storageConfigSource",
  [
    z
      .object({
        persistentSandboxesEnabled: z.boolean(),
        storageConfigSource: z.literal(SandboxStorageConfigSources.MANAGED),
        organizationStorageConfig: z.null(),
      })
      .strict(),
    z
      .object({
        persistentSandboxesEnabled: z.boolean(),
        storageConfigSource: z.literal(SandboxStorageConfigSources.ORGANIZATION),
        organizationStorageConfig: OrganizationSandboxStorageConfigV1Schema,
      })
      .strict(),
  ],
);

export const PutOrganizationSandboxStorageSettingsResponseSchema =
  GetOrganizationSandboxStorageSettingsResponseSchema;
