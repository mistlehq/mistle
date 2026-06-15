import { z } from "zod";

import { createRemoteMcpServerSelectionSchema } from "../../../shared/remote-mcp-server-catalog/index.js";
import { ExpoMcpServerCatalog, ExpoMcpServerIds } from "./mcp-catalog.js";

export const ExpoBindingConfigSchema = z
  .object({
    mcpServers: createRemoteMcpServerSelectionSchema({
      catalog: ExpoMcpServerCatalog,
      defaultSelectedIds: [ExpoMcpServerIds.EXPO],
    }),
  })
  .strict();

export type ExpoBindingConfig = z.output<typeof ExpoBindingConfigSchema>;
