import { z } from "@hono/zod-openapi";
import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";

import { singletonImageMetadataResponseSchema } from "../lib/singleton-image-metadata.js";

const multipartFileSchema = z
  .unknown()
  .openapi({
    type: "string",
    format: "binary",
  })
  .refine((value) => value instanceof File, {
    message: "Expected file upload.",
  });

export const profileImageUploadFormSchema = z
  .object({
    file: multipartFileSchema,
  })
  .strict();

export const profileImageMetadataResponseSchema = singletonImageMetadataResponseSchema;

export const LinkedAccountPrincipalSummarySchema = z
  .object({
    id: z.string().min(1),
    status: z.enum([
      UserExternalPrincipalStatuses.ACTIVE,
      UserExternalPrincipalStatuses.REAUTHORIZATION_REQUIRED,
    ]),
    providerSubjectId: z.string().min(1).nullable(),
    profile: z.record(z.string(), z.unknown()).nullable(),
    linkedAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const LinkedAccountCredentialSummarySchema = z
  .object({
    id: z.string().min(1),
    credentialKind: z.string().min(1),
    status: z.enum([
      UserExternalPrincipalCredentialStatuses.ACTIVE,
      UserExternalPrincipalCredentialStatuses.EXPIRED,
      UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED,
    ]),
    accessTokenExpiresAt: z.string().min(1).nullable(),
    refreshTokenExpiresAt: z.string().min(1).nullable(),
    lastValidatedAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1),
  })
  .strict();

export const LinkedAccountSchema = z
  .object({
    providerFamily: z.string().min(1),
    displayName: z.string().min(1),
    logoKey: z.string().min(1),
    configurationStatus: z.enum([
      OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      OrganizationIdentityLinkProviderConfigStatus.DISABLED,
    ]),
    principal: LinkedAccountPrincipalSummarySchema.nullable(),
    credential: LinkedAccountCredentialSummarySchema.nullable(),
  })
  .strict();

export const LinkedAccountsResponseSchema = z
  .object({
    linkedAccounts: z.array(LinkedAccountSchema),
  })
  .strict();

export const StartLinkedAccountAuthorizationResponseSchema = z
  .object({
    authorizationUrl: z.url(),
    expiresAt: z.string().min(1),
  })
  .strict();
