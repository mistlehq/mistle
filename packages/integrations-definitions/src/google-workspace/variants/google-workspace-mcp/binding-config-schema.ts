import { z } from "zod";

import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";

const GoogleWorkspaceMcpServerIdSet: ReadonlySet<string> = new Set(
  GoogleWorkspaceMcpServerCatalog.map((entry) => entry.id),
);
const GoogleWorkspaceEmailSchema = z.email();

function validateGoogleWorkspaceMcpServerIds(ids: ReadonlyArray<string>): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!GoogleWorkspaceMcpServerIdSet.has(id)) {
      throw new Error(`Unsupported Google Workspace tool id '${id}'.`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate Google Workspace tool id '${id}'.`);
    }
    seen.add(id);
  }
}

export const GoogleWorkspaceBindingConfigSchema = z
  .object({
    mcpServers: z
      .array(z.string())
      .default([])
      .superRefine((ids, context) => {
        try {
          validateGoogleWorkspaceMcpServerIds(ids);
        } catch (error) {
          context.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    workspaceUserEmail: z
      .string()
      .trim()
      .refine(
        (value) => value.length === 0 || GoogleWorkspaceEmailSchema.safeParse(value).success,
        {
          message: "Workspace user email must be a valid email address.",
        },
      )
      .default(""),
  })
  .strict();

export type GoogleWorkspaceBindingConfig = z.output<typeof GoogleWorkspaceBindingConfigSchema>;
