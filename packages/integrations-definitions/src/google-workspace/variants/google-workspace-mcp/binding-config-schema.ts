import { z } from "zod";

import { createRemoteMcpServerSelectionSchema } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";

export const GoogleWorkspaceBindingConfigSchema = z
  .object({
    mcpServers: createRemoteMcpServerSelectionSchema({
      catalog: GoogleWorkspaceMcpServerCatalog,
    }),
    workspaceUserEmail: z.preprocess(
      (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
      z.string().trim().pipe(z.email()).optional(),
    ),
  })
  .strict();

export type GoogleWorkspaceBindingConfig = z.output<typeof GoogleWorkspaceBindingConfigSchema>;
