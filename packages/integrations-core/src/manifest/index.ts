import { z } from "zod";

import { IntegrationManifestError, ManifestErrorCodes } from "../errors/index.js";
import { IntegrationKinds, type IntegrationManifest } from "../types/index.js";

type ValidationIssue = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

function formatIssues(issues: ReadonlyArray<ValidationIssue>): string {
  return issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

const IntegrationKindSchema = z.enum([
  IntegrationKinds.AGENT,
  IntegrationKinds.GIT,
  IntegrationKinds.CONNECTOR,
]);

export const IntegrationManifestBindingSchema = z
  .object({
    bindingId: z.string().min(1),
    kind: IntegrationKindSchema,
    connectionId: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const IntegrationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    integrations: z.array(IntegrationManifestBindingSchema),
  })
  .strict();

export function parseIntegrationManifest(input: unknown): IntegrationManifest {
  const parsedManifest = IntegrationManifestSchema.safeParse(input);

  if (!parsedManifest.success) {
    throw new IntegrationManifestError(
      ManifestErrorCodes.INVALID_MANIFEST,
      `Integration manifest validation failed. ${formatIssues(parsedManifest.error.issues)}`,
    );
  }

  return parsedManifest.data;
}
