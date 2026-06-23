import { z } from "zod";

import { createRemoteMcpServerSelectionSchema } from "../../../shared/remote-mcp-server-catalog/index.js";
import { AutumnMcpServerCatalog, AutumnMcpServerIds } from "./mcp-catalog.js";

export const AutumnBindingConfigSchema = z
  .object({
    mcpServers: createRemoteMcpServerSelectionSchema({
      catalog: AutumnMcpServerCatalog,
      defaultSelectedIds: [AutumnMcpServerIds.AUTUMN],
    }),
  })
  .strict();

export type AutumnBindingConfig = z.output<typeof AutumnBindingConfigSchema>;
