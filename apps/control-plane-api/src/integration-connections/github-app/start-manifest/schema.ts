import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";

export const StartGitHubAppManifestConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

const GitHubAppManifestOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("personal"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("organization"),
      organizationSlug: z
        .string()
        .trim()
        .min(1)
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
    })
    .strict(),
]);

export const StartGitHubAppManifestConnectionBodySchema = z
  .object({
    manifest: z.record(z.string(), z.unknown()),
    owner: GitHubAppManifestOwnerSchema,
  })
  .strict();

export const StartGitHubAppManifestConnectionResponseSchema = z
  .object({
    submissionUrl: z.url(),
    fields: z
      .object({
        manifest: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const StartGitHubAppManifestConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartGitHubAppManifestConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
