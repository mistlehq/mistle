import { z } from "zod";

import { createRemoteMcpServerSelectionSchema } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GcpMcpServerCatalog } from "./mcp-catalog.js";

export const GcpBindingConfigSchema = z
  .object({
    mcpServers: createRemoteMcpServerSelectionSchema({
      catalog: GcpMcpServerCatalog,
    }),
  })
  .strict();

export type GcpBindingConfig = z.output<typeof GcpBindingConfigSchema>;
