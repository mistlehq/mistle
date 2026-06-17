import { z } from "zod";

import { createRemoteMcpServerSelectionSchema } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";

export const GoogleWorkspaceBindingConfigSchema = z
  .object({
    mcpServers: createRemoteMcpServerSelectionSchema({
      catalog: GoogleWorkspaceMcpServerCatalog,
    }),
  })
  .strict();

export type GoogleWorkspaceBindingConfig = z.output<typeof GoogleWorkspaceBindingConfigSchema>;
